import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(
  new URL('../../db/migrations/004_source_record_revision_run_index.sql', import.meta.url),
  'utf8',
);
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

test('migration 004 adds exactly one synchronous run+revision secondary index', () => {
  assert.match(executableSql, /^ALTER TABLE source_record_revisions ADD INDEX idx_source_record_revisions_run_revision GLOBAL SYNC ON \(migration_run_id, revision\) COVER \(observed_at, row_hint, row_digest, change_class\);$/);
  assert.equal((executableSql.match(/ADD INDEX/g) ?? []).length, 1);
  assert.doesNotMatch(executableSql, /GLOBAL ASYNC|IF NOT EXISTS|\bDROP\b|\bCREATE TABLE\b/i);
});

test('migration 004 contains no seed data or financial vocabulary', () => {
  assert.doesNotMatch(executableSql, /\bINSERT\b|\bUPSERT\b|\bUPDATE\b|\bDELETE\b/i);
  assert.doesNotMatch(sql, /Карта|Налич|Вика|Ответы на форму|Synthetic|Uuid\s*\(/i);
});
