import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const initialSql = fs.readFileSync(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../../db/migrations/002_reference_source_labels.sql', import.meta.url), 'utf8');

test('reference source labels are added only by forward migration', () => {
  assert.doesNotMatch(initialSql, /normalized_source_label/);
  assert.match(sql, /ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8;/);
  assert.match(sql, /ALTER TABLE categories ADD COLUMN normalized_source_label Utf8;/);
});

test('migration is additive and contains exactly the two dedicated source-label column changes', () => {
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith('ALTER TABLE'));

  assert.deepEqual(statements, [
    'ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8',
    'ALTER TABLE categories ADD COLUMN normalized_source_label Utf8',
  ]);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bUPSERT\b|\bINSERT\b|\bDELETE\b/i);
  assert.doesNotMatch(sql, /IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /\bINDEX\b/i);
});

test('display name remains separate from durable source label contract', () => {
  assert.match(initialSql, /CREATE TABLE accounts \([\s\S]*?name Utf8,/);
  assert.match(initialSql, /CREATE TABLE categories \([\s\S]*?name Utf8,/);
  assert.doesNotMatch(sql, /RENAME|ALTER COLUMN name|DROP COLUMN name/i);
});

test('migration contains no reference vocabulary or private identifiers', () => {
  assert.doesNotMatch(sql, /Карта|Налич|Вика|Synthetic|Uuid\s*\(/i);
});
