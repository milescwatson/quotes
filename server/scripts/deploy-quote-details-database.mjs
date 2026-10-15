// Development-only additive quote details migration. Each DDL statement commits separately.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { target, developmentDatabase } from './development-database.mjs';
const root = new URL('../../', import.meta.url);
const path = new URL('database/deployments/development-0010.json', root);
const { db } = developmentDatabase();
let journal;
try { journal = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; journal = { target, startedAt: new Date().toISOString(), events: [] }; }
assert.deepEqual(journal.target, target);
const persist = () => writeFile(path, JSON.stringify(journal, null, 2) + '\n');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originals = async () => (await db.query('SELECT id,organization_id,customer_id,owner_user_id,customer_name,project_name,modified_by,modified_when::text,lines,multiple,archived_at FROM public.quotes ORDER BY id')).rows;
try {
  await db.connect();
  if (!journal.before) { const rows = await originals(); journal.before = { count: rows.length, sha256: digest(rows) }; await persist(); }
  for (const file of ['schema', 'permissions']) {
    const sql = (await readFile(new URL(`database/versions/0010/quotes/${file}.sql`, root), 'utf8')).replace(/--[^\n]*/g, '').replaceAll(':"api_role"', '"quotes_api"');
    for (const [index, statement] of sql.split(';').map(s => s.trim()).filter(Boolean).entries()) {
      const key = `${file}:${index + 1}`, sha256 = digest(statement);
      const previous = journal.events.find(event => event.key === key);
      if (previous) { assert.equal(previous.sha256, sha256); assert.equal(previous.status, 'completed', 'Inspect incomplete migration before retrying.'); continue; }
      const event = { key, sql: statement, sha256, status: 'started', startedAt: new Date().toISOString() };
      journal.events.push(event); await persist();
      const result = await db.query(statement);
      const job = result.rows[0]?.job_id ?? result.rows[0]?.job_uuid;
      if (job) {
        event.jobId = job; await persist();
        for (let attempt = 0; ; attempt++) {
          const state = (await db.query('SELECT status FROM sys.jobs WHERE job_id=$1', [job])).rows[0];
          if (state?.status === 'completed') break;
          assert.ok(state?.status !== 'failed' && attempt < 120, 'DDL validation failed or timed out.');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      event.status = 'completed'; event.completedAt = new Date().toISOString(); await persist();
      console.log(JSON.stringify({ key, status: 'completed' }));
    }
  }
  const grants = (await db.query("SELECT has_column_privilege('quotes_api','quotes','location','UPDATE') AS location_update,has_column_privilege('quotes_api','quotes','created_by_user_id','UPDATE') AS author_update")).rows[0];
  assert.deepEqual(grants, { location_update: true, author_update: false });
  const constraint = (await db.query("SELECT convalidated FROM pg_constraint WHERE conname='quotes_created_by_user_fk'")).rows[0];
  assert.equal(constraint.convalidated, true);
  assert.equal(digest(await originals()), journal.before.sha256, 'Existing quote fields changed during migration.');
  journal.verification = { grants, authorForeignKeyValidated: true, originalFieldsUnchanged: true };
  journal.status = 'verified'; journal.verifiedAt = new Date().toISOString(); await persist();
  console.log(JSON.stringify(journal.verification));
} finally { await db.end(); }
