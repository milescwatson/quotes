// Installs only the PDF worker's read-only runtime role; no quote schema changes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { target, developmentDatabase } from './development-database.mjs';
assert.equal(target.environment, 'development');
const { db } = developmentDatabase();
try {
  await db.connect();
  const statements = (await readFile(new URL('../../database/runtime/quote-pdf-worker.sql', import.meta.url), 'utf8'))
    .replace(/--[^\n]*/g, '').split(';').map(sql => sql.trim()).filter(Boolean);
  const exists = (await db.query("SELECT 1 FROM pg_roles WHERE rolname='quotes_pdf_worker'")).rows.length > 0;
  for (const sql of statements) {
    if (exists && sql.startsWith('CREATE ROLE')) continue;
    await db.query(sql);
  }
  const { rows } = await db.query(`SELECT
    has_table_privilege('quotes_pdf_worker','public.quotes','SELECT') AS read_quotes,
    has_table_privilege('quotes_pdf_worker','public.organizations','SELECT') AS read_organizations,
    has_table_privilege('quotes_pdf_worker','public.users','SELECT') AS read_users,
    has_table_privilege('quotes_pdf_worker','public.quotes','INSERT') AS insert_quotes,
    has_any_column_privilege('quotes_pdf_worker','public.quotes','UPDATE') AS update_quotes,
    has_table_privilege('quotes_pdf_worker','public.quotes','DELETE') AS delete_quotes`);
  assert.deepEqual(rows[0], { read_quotes: true, read_organizations: true, read_users: true, insert_quotes: false, update_quotes: false, delete_quotes: false });
  console.log(JSON.stringify({ target, grants: rows[0] }));
} finally { await db.end(); }
