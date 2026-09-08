import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const AUTH_SCHEMA = new URL('../../db/auth/001_owner_auth.sql', import.meta.url);

test('OWNER auth bootstrap is isolated from the financial schema migration ledger', async () => {
  const sql = await readFile(AUTH_SCHEMA, 'utf8');

  assert.match(sql, /CREATE TABLE owner_oauth_transactions/u);
  assert.match(sql, /CREATE TABLE owner_sessions/u);
  assert.match(sql, /state_hash Utf8 NOT NULL/u);
  assert.match(sql, /session_hash Utf8 NOT NULL/u);
  assert.match(sql, /code_verifier Utf8 NOT NULL/u);
  assert.match(sql, /expires_at_ms Uint64 NOT NULL/u);
  assert.equal((sql.match(/WITH \(STORE = ROW\)/gu) ?? []).length, 2);

  assert.doesNotMatch(sql, /CREATE TABLE schema_migrations/u);
  assert.doesNotMatch(sql, /INSERT INTO schema_migrations/u);
  assert.doesNotMatch(sql, /ALTER TABLE schema_migrations/u);
  assert.doesNotMatch(sql, /(?:CREATE|ALTER|INSERT INTO|UPDATE|DELETE FROM)\s+(?:transactions|source_records|migration_runs)\b/u);
});
