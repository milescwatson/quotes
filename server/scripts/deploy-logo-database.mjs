// Additive development-only 0009 migration; no traffic pause is required.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { target, developmentDatabase } from './development-database.mjs';
const root = new URL('../../', import.meta.url);
const path = new URL('database/deployments/development-0009.json', root);
const { db } = developmentDatabase();
let journal;
try { journal = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; journal = { target, startedAt: new Date().toISOString(), events: [] }; }
assert.deepEqual(journal.target, target);
const persist = () => writeFile(path, JSON.stringify(journal, null, 2) + '\n');
try {
  await db.connect();
  for (const file of ['schema', 'permissions']) {
    const sql = (await readFile(new URL(`database/versions/0009/organizations/${file}.sql`, root), 'utf8')).replaceAll(':"api_role"', '"quotes_api"').trim();
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const previous = journal.events.find(event => event.file === file);
    if (previous) { assert.equal(previous.sha256, sha256); assert.equal(previous.status, 'completed', 'Inspect incomplete migration before retrying.'); continue; }
    const event = { file, sha256, status: 'started', startedAt: new Date().toISOString() };
    journal.events.push(event); await persist();
    const result = await db.query(sql);
    const job = result.rows[0]?.job_id ?? result.rows[0]?.job_uuid;
    if (job) {
      event.jobId = job; await persist();
      for (let attempt = 0; ; attempt++) {
        const state = (await db.query('SELECT status FROM sys.jobs WHERE job_id=$1', [job])).rows[0];
        if (state?.status === 'completed') break;
        assert.ok(state?.status !== 'failed' && attempt < 120, 'DDL job failed or timed out.');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    event.status = 'completed'; event.completedAt = new Date().toISOString(); await persist();
  }
  const column = (await db.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='logo_id'")).rows[0];
  assert.equal(column?.data_type, 'uuid'); assert.equal(column.is_nullable, 'YES');
  const grants = (await db.query("SELECT has_column_privilege('quotes_api','organizations','logo_id','SELECT') AS read,has_column_privilege('quotes_api','organizations','logo_id','UPDATE') AS update")).rows[0];
  assert.equal(grants.read, true); assert.equal(grants.update, true);
  journal.verification = { column, grants };
  journal.status = 'verified'; journal.verifiedAt = new Date().toISOString(); await persist();
  console.log(JSON.stringify(journal.verification));
} finally { await db.end(); }
