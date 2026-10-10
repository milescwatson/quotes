// Read-only preflight. Credentials remain in memory and are never printed.
// DSQL_ENDPOINT, AWS_PROFILE and AWS_REGION must identify the intended environment.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
const host = process.env.DSQL_ENDPOINT;
const profile = process.env.AWS_PROFILE;
const region = process.env.AWS_REGION;
if (!host || !profile || !region) throw new Error('Set DSQL_ENDPOINT, AWS_PROFILE and AWS_REGION.');
const password = execFileSync('aws', ['dsql', 'generate-db-connect-admin-auth-token', '--hostname', host,
  '--profile', profile, '--region', region], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const client = new pg.Client({ host, user: 'admin', database: 'postgres', password,
  ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, query_timeout: 5000 });
let stage = 'connect';
try {
  await client.connect();
  stage = 'begin';
  await client.query('BEGIN READ ONLY');
  stage = 'tables';
  const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    AND table_name IN ('users','organizations','quotes','taxonomies','taxonomy_versions','taxonomy_version_segments','taxonomy_version_options','taxonomy_subscriptions') ORDER BY table_name`)).rows;
  stage = 'columns';
  const columns = (await client.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('taxonomies','taxonomy_versions') ORDER BY table_name,ordinal_position`)).rows;
  await client.query('COMMIT');
  console.log(JSON.stringify({ tables, taxonomyColumns: columns }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Exclude token-bearing connection/configuration errors from output.
  console.error(JSON.stringify({ stage, errorCode: error.code || 'INVENTORY_FAILED', ...(stage !== 'connect' ? { message: error.message } : {}) }));
  process.exitCode = 1;
} finally { await client.end(); }
