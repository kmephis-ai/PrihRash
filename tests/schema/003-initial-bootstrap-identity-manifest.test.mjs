import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(
  new URL('../../db/migrations/003_initial_bootstrap_identity_manifest.sql', import.meta.url),
  'utf8',
);
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

test('forward migration adds only the run-scoped initial identity manifest table', () => {
  assert.match(executableSql, /CREATE TABLE initial_bootstrap_identity_manifests \(/);
  assert.equal((executableSql.match(/CREATE TABLE /g) ?? []).length, 1);
  assert.match(executableSql, /migration_run_id Uuid NOT NULL/);
  assert.match(executableSql, /source_snapshot_id Uuid NOT NULL/);
  assert.match(executableSql, /source_snapshot_digest String NOT NULL/);
  assert.match(executableSql, /binding_count Uint64 NOT NULL/);
  assert.match(executableSql, /bindings JsonDocument NOT NULL/);
  assert.match(executableSql, /PRIMARY KEY \(migration_run_id\)/);
  assert.match(executableSql, /WITH \(STORE = ROW\);/);
});

test('identity manifest migration is append-only foundation without hidden seed data', () => {
  assert.doesNotMatch(executableSql, /IF NOT EXISTS|\bDROP\b|\bALTER\b|\bINDEX\b/i);
  assert.doesNotMatch(executableSql, /\bINSERT\b|\bUPSERT\b|\bUPDATE\b|\bDELETE\b/i);
  assert.doesNotMatch(sql, /Карта|Налич|Вика|Ответы на форму|Synthetic|Uuid\s*\(/i);
});
