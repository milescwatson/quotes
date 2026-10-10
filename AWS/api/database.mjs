import pg from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
let pool;
export function getPool() {
  if (!pool) {
    const host = process.env.DSQL_ENDPOINT;
    const user = process.env.DSQL_USER;
    if (!host || !user || user === 'admin')
      throw new Error('Restricted database connection is not configured');
    const signer = new DsqlSigner({
      hostname: host,
      region: process.env.AWS_REGION,
    });
    pool = new pg.Pool({
      host,
      user,
      database: 'postgres',
      port: 5432,
      password: () => signer.getDbConnectAuthToken(),
      ssl: { rejectUnauthorized: true },
      max: 1,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      maxLifetimeSeconds: 300,
      // DSQL rejects statement_timeout in PostgreSQL startup parameters.
      query_timeout: 5000,
    });
  }
  return pool;
}
export function transactions(
  pool,
  { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 5 } = {},
) {
  return async (work) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        // A client-side timeout can leave a server query in flight. Close that
        // connection rather than return an uncertain transaction to the pool.
        discard = error.message === 'Query read timeout';
        if (!discard) {
          try { await client.query('ROLLBACK'); } catch { discard = true; }
        }
        if (!['40001', '23505'].includes(error.code) || attempt === attempts - 1)
          throw error;
      } finally {
        client.release(discard);
      }
      await sleep(Math.min(50 * 2 ** attempt, 1000) * (0.5 + Math.random()));
    }
  };
}
