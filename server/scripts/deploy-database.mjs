// Deliberately development-only. Records each statement before and after execution.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
const root = new URL('../../', import.meta.url);
const target = {
  environment: 'development',
  account: '415221799122',
  region: 'us-west-2',
  cluster: '3zuetvjhixkp3qeuzxxosvlssq',
  profile: 'quotes-development',
};
const host = `${target.cluster}.dsql.${target.region}.on.aws`;
const aws = (args) =>
  execFileSync(
    'aws',
    [...args, '--profile', target.profile, '--region', target.region],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const mode = process.argv[2];
if (
  ![
    'inventory',
    'apply',
    'verify',
    'apply-principals',
    'verify-principals',
  ].includes(mode)
)
  throw new Error(
    'Use inventory, apply, verify, apply-principals, or verify-principals.',
  );
const principals = mode.endsWith('-principals');
const identity = JSON.parse(aws(['sts', 'get-caller-identity']));
if (identity.Account !== target.account)
  throw new Error('Unexpected AWS account');
const cluster = JSON.parse(
  aws(['dsql', 'get-cluster', '--identifier', target.cluster]),
);
if (cluster.status !== 'ACTIVE') throw new Error('Cluster not ACTIVE');
const client = new pg.Client({
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
const journalPath = new URL(
  principals
    ? 'database/deployments/development-0003.json'
    : 'database/deployments/development.json',
  root,
);
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  journal = { target, startedAt: new Date().toISOString(), events: [] };
}
if (JSON.stringify(journal.target) !== JSON.stringify(target))
  throw new Error('Journal target mismatch');
const persist = () =>
  writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n');
const q = async (sql, args = []) => (await client.query(sql, args)).rows;
async function run(key, sql) {
  const hash = createHash('sha256').update(sql).digest('hex');
  const prior = journal.events.find((e) => e.key === key);
  if (prior) {
    if (prior.sha256 !== hash || prior.status !== 'completed')
      throw new Error(`Inspect unresolved or changed statement: ${key}`);
    return;
  }
  const event = {
    key,
    sha256: hash,
    sql,
    status: 'started',
    startedAt: new Date().toISOString(),
  };
  journal.events.push(event);
  await persist();
  try {
    const rows = await q(sql);
    event.result = rows;
    await persist();
    const job = rows[0]?.job_id ?? rows[0]?.job_uuid;
    if (job) {
      for (let i = 0; i < 120; i++) {
        const [state] = await q(
          'SELECT job_id,status,details FROM sys.jobs WHERE job_id=$1',
          [job],
        );
        if (state?.status === 'completed') {
          event.job = state;
          break;
        }
        if (state?.status === 'failed')
          throw new Error(`Async job failed: ${state.details}`);
        if (i === 119) throw new Error(`Async job still pending: ${job}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    event.status = 'completed';
    event.completedAt = new Date().toISOString();
    await persist();
    console.log(JSON.stringify({ key, status: event.status, job: event.job }));
  } catch (e) {
    event.status = 'failed';
    event.error = { code: e.code, message: e.message };
    await persist();
    throw e;
  }
}
async function snapshot() {
  return {
    tables: await q(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    ),
    roles: await q(
      "SELECT rolname,rolcanlogin,rolsuper FROM pg_roles WHERE rolname IN ('quotes_api','quotes_operator')",
    ),
    mappings: await q('SELECT arn,pg_role_name FROM sys.iam_pg_role_mappings'),
    schemaAccess: await q(
      "SELECT rolname,has_schema_privilege(rolname,'public','USAGE') AS usage FROM pg_roles WHERE rolname IN ('quotes_api','quotes_operator')",
    ),
    constraints: await q(
      "SELECT c.conname,c.contype,c.convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY c.conname",
    ),
    indexes: await q(
      "SELECT c.relname,i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname",
    ),
  };
}
try {
  await client.connect();
  if (mode === 'inventory') {
    console.log(JSON.stringify(await snapshot(), null, 2));
  }
  if (mode === 'apply') {
    if (!journal.events.length) {
      const before = await snapshot();
      if (before.tables.length || before.roles.length)
        throw new Error(
          'First-install requires empty application schema and absent roles',
        );
      journal.before = before;
      await persist();
    }
    for (const file of [
      'database/versions/0001/identity/schema.sql',
      'database/versions/0001/quotes/schema.sql',
      'database/versions/0002/taxonomy/schema.sql',
    ]) {
      const statements = (await readFile(new URL(file, root), 'utf8'))
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < statements.length; i++)
        await run(`${file}:${i + 1}`, statements[i]);
    }
    await run('role:api', 'CREATE ROLE quotes_api WITH LOGIN');
    await run('role:operator', 'CREATE ROLE quotes_operator WITH LOGIN');
    for (const file of [
      'database/versions/0001/identity/permissions.sql',
      'database/versions/0001/quotes/permissions.sql',
      'database/versions/0002/taxonomy/permissions.sql',
    ]) {
      const statements = (await readFile(new URL(file, root), 'utf8'))
        .replace(/--[^\n]*/g, '')
        .replaceAll(':"api_role"', '"quotes_api"')
        .replaceAll(':"operator_role"', '"quotes_operator"')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < statements.length; i++)
        await run(`${file}:${i + 1}`, statements[i]);
    }
    await run(
      'mapping:lambda',
      `AWS IAM GRANT quotes_api TO 'arn:aws:iam::${target.account}:role/quotes-development-api'`,
    );
    journal.appliedAt ??= new Date().toISOString();
    await persist();
  }
  if (mode === 'apply-principals') {
    if (!journal.events.length) {
      const before = await snapshot();
      if (
        before.tables.length !== 7 ||
        before.tables.some((t) => t.table_name === 'principals') ||
        before.constraints.some((c) => !c.convalidated) ||
        before.indexes.some((i) => !i.indisvalid)
      )
        throw new Error('Expected verified 0002 baseline');
      const [counts] = await q(
        'SELECT (SELECT count(*) FROM public.taxonomies) AS taxonomies, (SELECT count(*) FROM public.taxonomy_versions) AS versions',
      );
      if (counts.taxonomies !== '0' || counts.versions !== '0')
        throw new Error(
          'This development migration requires empty taxonomy tables; explicit mapping needed otherwise',
        );
      journal.before = before;
      journal.preflightCounts = counts;
      await persist();
    }
    for (const file of [
      'database/versions/0003/principals/schema.sql',
      'database/versions/0003/principals/enforce.sql',
      'database/versions/0003/principals/permissions.sql',
    ]) {
      const statements = (await readFile(new URL(file, root), 'utf8'))
        .replace(/--[^\n]*/g, '')
        .replaceAll(':"api_role"', '"quotes_api"')
        .replaceAll(':"operator_role"', '"quotes_operator"')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < statements.length; i++)
        await run(`${file}:${i + 1}`, statements[i]);
    }
    await run(
      '0003:validate-empty-history',
      'ALTER TABLE ASYNC public.taxonomy_versions VALIDATE CONSTRAINT taxonomy_versions_principal_required',
    );
    journal.appliedAt ??= new Date().toISOString();
    await persist();
  }
  if (mode !== 'inventory') {
    journal.verification = await snapshot();
    journal.verifiedAt = new Date().toISOString();
    await persist();
    if (
      journal.verification.tables.length !== (principals ? 8 : 7) ||
      journal.verification.constraints.some((c) => !c.convalidated) ||
      journal.verification.indexes.some((i) => !i.indisvalid)
    )
      throw new Error('Schema verification failed');
    console.log(
      JSON.stringify({
        status: 'schema_verified',
        tables: journal.verification.tables,
        appliedAt: journal.appliedAt,
      }),
    );
  }
} catch (e) {
  console.error(
    JSON.stringify({ code: e.code ?? 'DEPLOYMENT_FAILED', message: e.message }),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
