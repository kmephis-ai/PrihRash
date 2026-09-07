import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const initialSql = fs.readFileSync(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../../db/migrations/002_reference_source_labels.sql', import.meta.url), 'utf8');
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function executableStatements() {
  return executableSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

test('reference source labels are added only by forward migration', () => {
  assert.doesNotMatch(initialSql, /normalized_source_label/);
  assert.match(executableSql, /ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8;/);
  assert.match(executableSql, /ALTER TABLE categories ADD COLUMN normalized_source_label Utf8;/);
});

test('migration is additive and contains exactly the two dedicated source-label column changes', () => {
  assert.deepEqual(executableStatements(), [
    'ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8',
    'ALTER TABLE categories ADD COLUMN normalized_source_label Utf8',
  ]);
  assert.doesNotMatch(executableSql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(executableSql, /\bUPDATE\b|\bUPSERT\b|\bINSERT\b|\bDELETE\b/i);
  assert.doesNotMatch(executableSql, /IF NOT EXISTS/i);
  assert.doesNotMatch(executableSql, /\bINDEX\b/i);
});

test('display name remains separate from durable source label contract', () => {
  assert.match(initialSql, /CREATE TABLE accounts \([\s\S]*?name Utf8,/);
  assert.match(initialSql, /CREATE TABLE categories \([\s\S]*?name Utf8,/);
  assert.doesNotMatch(executableSql, /\bRENAME\b|ALTER\s+COLUMN\s+name\b|DROP\s+COLUMN\s+name\b/i);
});

test('migration contains no reference vocabulary or private identifiers', () => {
  assert.doesNotMatch(sql, /Карта|Налич|Вика|Synthetic|Uuid\s*\(/i);
});
