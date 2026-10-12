// Development only. Creates a temporary Lambda using the existing runtime role,
// seeds a marked identity fixture, then removes both after verification.
import { execFileSync } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import pg from 'pg';
const host = '3zuetvjhixkp3qeuzxxosvlssq.dsql.us-west-2.on.aws';
const aws = (args) =>
  execFileSync(
    'aws',
    [...args, '--profile', 'quotes-development', '--region', 'us-west-2'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
assert.equal(
  JSON.parse(aws(['sts', 'get-caller-identity'])).Account,
  '415221799122',
);
const db = new pg.Client({
  host,
  user: 'admin',
  database: 'postgres',
  password: aws([
    'dsql',
    'generate-db-connect-admin-auth-token',
    '--hostname',
    host,
  ]),
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
});
const result = {
  environment: 'development',
  startedAt: new Date().toISOString(),
};
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const runId = randomUUID();
const name = `quotes-development-db-check-${runId.slice(0, 8)}`;
const dir = await mkdtemp(join(tmpdir(), 'quotes-db-check-'));
let functionCreated = false,
  userId,
  orgId;
try {
  await db.connect();
  await q('BEGIN');
  const identity = {
    issuer: `https://deployment.invalid/${runId}`,
    sub: 'verification',
  };
  userId = (
    await q(
      "INSERT INTO users(cognito_issuer,cognito_subject,email,normalized_email) VALUES ($1,$2,'deployment@example.invalid','deployment@example.invalid') RETURNING id",
      [identity.issuer, identity.sub],
    )
  )[0].id;
  orgId = (
    await q(
      "INSERT INTO organizations(name,status) VALUES ($1,'active') RETURNING id",
      [`Deployment verification ${runId}`],
    )
  )[0].id;
  await q(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'admin')",
    [orgId, userId],
  );
  await q('COMMIT');
  result.fixture = { userId, orgId, runId };
  await build({
    entryPoints: [
      new URL('./database-smoke-handler.mjs', import.meta.url).pathname,
    ],
    outfile: join(dir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: ['pg-native'],
  });
  execFileSync('zip', ['-q', 'function.zip', 'index.mjs'], {
    cwd: dir,
    stdio: 'pipe',
  });
  const created = JSON.parse(
    aws([
      'lambda',
      'create-function',
      '--function-name',
      name,
      '--runtime',
      'nodejs22.x',
      '--role',
      'arn:aws:iam::415221799122:role/quotes-development-api',
      '--handler',
      'index.handler',
      '--timeout',
      '60',
      '--memory-size',
      '512',
      '--zip-file',
      `fileb://${join(dir, 'function.zip')}`,
      '--environment',
      JSON.stringify({
        Variables: { DSQL_ENDPOINT: host, DSQL_USER: 'quotes_api' },
      }),
    ]),
  );
  functionCreated = true;
  result.functionArn = created.FunctionArn;
  aws(['lambda', 'wait', 'function-active-v2', '--function-name', name]);
  await writeFile(
    join(dir, 'payload.json'),
    JSON.stringify({ orgId, identity }),
  );
  const invocation = JSON.parse(
    aws([
      'lambda',
      'invoke',
      '--function-name',
      name,
      '--payload',
      `fileb://${join(dir, 'payload.json')}`,
      join(dir, 'response.json'),
    ]),
  );
  result.invocation = invocation;
  result.smoke = JSON.parse(await readFile(join(dir, 'response.json'), 'utf8'));
  assert.equal(result.smoke.status, 'passed', JSON.stringify(result.smoke));
  result.status = 'passed';
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  result.status = 'failed';
  result.error = { code: e.code, message: e.message };
  process.exitCode = 1;
} finally {
  if (functionCreated) {
    try {
      aws(['lambda', 'delete-function', '--function-name', name]);
      result.temporaryFunctionDeleted = true;
    } catch (e) {
      result.cleanupError = 'Temporary Lambda deletion failed';
      process.exitCode = 1;
    }
  }
  try {
    await q('BEGIN');
    if (orgId)
      await q(
        'DELETE FROM organization_memberships WHERE organization_id=$1 AND user_id=$2',
        [orgId, userId],
      );
    if (orgId) await q('DELETE FROM organizations WHERE id=$1', [orgId]);
    if (userId) await q('DELETE FROM users WHERE id=$1', [userId]);
    await q('COMMIT');
    result.identityFixtureDeleted = true;
    result.rowCounts = {};
    for (const table of [
      'users',
      'organizations',
      'organization_memberships',
      'identity_audit_events',
      'quotes',
      'taxonomies',
      'taxonomy_versions',
      'principals',
    ])
      result.rowCounts[table] = Number(
        (await q(`SELECT count(*) AS n FROM public.${table}`))[0].n,
      );
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    result.cleanupError = e.message;
    process.exitCode = 1;
  }
  await db.end();
  await rm(dir, { recursive: true, force: true });
  result.completedAt = new Date().toISOString();
  await writeFile(
    new URL(
      '../../database/deployments/development-0003-validation.json',
      import.meta.url,
    ),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
}
