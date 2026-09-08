import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  YdbAdapter,
  YdbTransportCommitOutcomeUnknownError,
} from '../../dist/integration/ydb/adapter.js';
import {
  OwnerAuthPersistenceError,
  YdbOwnerAuthPersistence,
} from '../../dist/auth/ydbOwnerAuthPersistence.js';

const STATE = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url');
const CODE_VERIFIER = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => 200 - index)).toString('base64url');
const NOW_MS = 1_788_870_000_000;
const EXPIRES_AT_MS = NOW_MS + 15 * 60 * 1000;

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deterministicRandom() {
  return {
    randomBytes(size) {
      assert.equal(size, 32);
      return Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    },
  };
}

function parameter(statement, name) {
  const value = statement.parameters[name]?.value;
  assert.notEqual(value, undefined);
  return value;
}

function cloneMap(source) {
  return new Map([...source.entries()].map(([key, value]) => [key, { ...value }]));
}

function createStatefulTransport(options = {}) {
  let oauthTransactions = new Map();
  let sessions = new Map();
  const events = [];

  function execute(statement, stores) {
    events.push(['execute', statement]);
    const { oauth, session } = stores;

    if (statement.text.startsWith('INSERT INTO owner_oauth_transactions')) {
      if (options.writeError) throw new Error('private-write-provider-detail');
      const key = parameter(statement, 'state_hash');
      if (oauth.has(key)) throw new Error('private-duplicate-state-detail');
      oauth.set(key, {
        code_verifier: parameter(statement, 'code_verifier'),
        created_at_ms: parameter(statement, 'created_at_ms'),
      });
      return { rows: [] };
    }
    if (statement.text.startsWith('SELECT code_verifier')) {
      const key = parameter(statement, 'state_hash');
      const row = options.malformedTransactionRow ?? oauth.get(key);
      return { rows: row === undefined ? [] : [row] };
    }
    if (statement.text.startsWith('DELETE FROM owner_oauth_transactions')) {
      oauth.delete(parameter(statement, 'state_hash'));
      return { rows: [] };
    }
    if (statement.text.startsWith('INSERT INTO owner_sessions')) {
      if (options.writeError) throw new Error('private-write-provider-detail');
      const key = parameter(statement, 'session_hash');
      if (session.has(key)) throw new Error('private-duplicate-session-detail');
      session.set(key, {
        role: parameter(statement, 'role'),
        issued_at_ms: parameter(statement, 'issued_at_ms'),
        expires_at_ms: parameter(statement, 'expires_at_ms'),
      });
      return { rows: [] };
    }
    if (statement.text.startsWith('SELECT role')) {
      const key = parameter(statement, 'session_hash');
      const row = options.malformedSessionRow ?? session.get(key);
      return { rows: row === undefined ? [] : [row] };
    }
    if (statement.text.startsWith('DELETE FROM owner_sessions')) {
      session.delete(parameter(statement, 'session_hash'));
      return { rows: [] };
    }
    throw new Error(`unexpected statement: ${statement.text}`);
  }

  const transport = {
    async executeRead(statement) {
      events.push(['read']);
      if (options.readError) throw new Error('private-read-provider-detail');
      return execute(statement, { oauth: oauthTransactions, session: sessions });
    },
    async serializableReadWrite(work) {
      events.push(['begin']);
      const oauth = cloneMap(oauthTransactions);
      const session = cloneMap(sessions);
      const tx = Object.freeze({
        async execute(statement) {
          return execute(statement, { oauth, session });
        },
      });
      let value;
      try {
        value = await work(tx);
      } catch (error) {
        events.push(['rollback']);
        throw error;
      }
      if (options.commitUnknown) {
        events.push(['commit-unknown']);
        throw new YdbTransportCommitOutcomeUnknownError(new Error('private-commit-provider-detail'));
      }
      oauthTransactions = oauth;
      sessions = session;
      events.push(['commit']);
      return value;
    },
  };

  return {
    events,
    transport,
    oauthEntries: () => [...oauthTransactions.entries()],
    sessionEntries: () => [...sessions.entries()],
  };
}

function persistence(fake, options = {}) {
  return new YdbOwnerAuthPersistence(new YdbAdapter(fake.transport), {
    random: options.random ?? deterministicRandom(),
  });
}

function assertSafeError(error, code, privateMarkers = []) {
  assert.equal(error instanceof OwnerAuthPersistenceError, true);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  const serialized = JSON.stringify({ name: error.name, code: error.code, message: error.message });
  for (const marker of privateMarkers) assert.equal(serialized.includes(marker), false);
  return true;
}

test('OAuth transaction stores hashed state and consumes it exactly once atomically', async () => {
  const fake = createStatefulTransport();
  const store = persistence(fake);
  await store.create({ state: STATE, codeVerifier: CODE_VERIFIER, createdAtMs: NOW_MS });

  const entries = fake.oauthEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], sha256Hex(STATE));
  assert.notEqual(entries[0][0], STATE);
  assert.equal(entries[0][1].code_verifier, CODE_VERIFIER);

  const consumed = await store.consume(STATE);
  assert.deepEqual(consumed, { state: STATE, codeVerifier: CODE_VERIFIER, createdAtMs: NOW_MS });
  assert.equal(fake.oauthEntries().length, 0);
  assert.equal(await store.consume(STATE), null);

  const consumeEvents = fake.events.slice(3).map(([kind, statement]) => [kind, statement?.text ?? null]);
  assert.deepEqual(consumeEvents.slice(0, 4).map(([kind]) => kind), ['begin', 'execute', 'execute', 'commit']);
  assert.match(consumeEvents[1][1], /^SELECT code_verifier/u);
  assert.match(consumeEvents[2][1], /^DELETE FROM owner_oauth_transactions/u);
});

test('duplicate OAuth state never overwrites the original one-time transaction', async () => {
  const fake = createStatefulTransport();
  const store = persistence(fake);
  await store.create({ state: STATE, codeVerifier: CODE_VERIFIER, createdAtMs: NOW_MS });

  const replacementVerifier = 'A'.repeat(43);
  await assert.rejects(
    () => store.create({ state: STATE, codeVerifier: replacementVerifier, createdAtMs: NOW_MS + 1 }),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_FAILED', [STATE, replacementVerifier]),
  );
  assert.equal(fake.oauthEntries()[0][1].code_verifier, CODE_VERIFIER);
});

test('session issue stores only SHA-256 handle and verifier enforces backend time bounds', async () => {
  const fake = createStatefulTransport();
  const store = persistence(fake);
  const handle = await store.issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: EXPIRES_AT_MS });

  assert.match(handle, /^[A-Za-z0-9_-]{43}$/u);
  const entries = fake.sessionEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0], sha256Hex(handle));
  assert.equal(entries[0][1].role, 'OWNER');
  assert.equal(entries[0][1].issued_at_ms, BigInt(NOW_MS));
  assert.equal(entries[0][1].expires_at_ms, BigInt(EXPIRES_AT_MS));

  const serializedStatements = JSON.stringify(fake.events.map(([, statement]) => statement ?? null), (_, value) => (
    typeof value === 'bigint' ? value.toString() : value
  ));
  assert.equal(serializedStatements.includes(handle), false);

  assert.equal(await store.verify(handle, NOW_MS - 1), null);
  assert.deepEqual(await store.verify(handle, NOW_MS), { role: 'OWNER', expiresAtMs: EXPIRES_AT_MS });
  assert.deepEqual(await store.verify(handle, EXPIRES_AT_MS - 1), { role: 'OWNER', expiresAtMs: EXPIRES_AT_MS });
  assert.equal(await store.verify(handle, EXPIRES_AT_MS), null);
  assert.equal(await store.verify('not-a-session-handle', NOW_MS), null);
});

test('revoke removes exact hashed session and previously valid handle no longer verifies', async () => {
  const fake = createStatefulTransport();
  const store = persistence(fake);
  const handle = await store.issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: EXPIRES_AT_MS });
  assert.deepEqual(await store.verify(handle, NOW_MS), { role: 'OWNER', expiresAtMs: EXPIRES_AT_MS });

  await store.revoke(handle);
  assert.equal(fake.sessionEntries().length, 0);
  assert.equal(await store.verify(handle, NOW_MS), null);
});

test('malformed stored OWNER evidence fails closed with value-free error', async () => {
  const fake = createStatefulTransport({
    malformedSessionRow: {
      role: 'MEMBER',
      issued_at_ms: BigInt(NOW_MS),
      expires_at_ms: BigInt(EXPIRES_AT_MS),
      private_marker: 'private-row-detail',
    },
  });
  const store = persistence(fake);
  const handle = await store.issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: EXPIRES_AT_MS });

  await assert.rejects(
    () => store.verify(handle, NOW_MS),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_EVIDENCE_INVALID', [handle, 'private-row-detail']),
  );
});

test('malformed OAuth transaction evidence is not deleted and fails closed', async () => {
  const fake = createStatefulTransport({
    malformedTransactionRow: { code_verifier: 'bad', created_at_ms: BigInt(NOW_MS) },
  });
  const store = persistence(fake);
  await store.create({ state: STATE, codeVerifier: CODE_VERIFIER, createdAtMs: NOW_MS });

  await assert.rejects(
    () => store.consume(STATE),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_EVIDENCE_INVALID', [STATE, CODE_VERIFIER]),
  );
  assert.equal(fake.oauthEntries().length, 1);
  assert.equal(fake.events.at(-1)[0], 'rollback');
});

test('transport and commit-unknown failures never become successful auth persistence results', async () => {
  const writeFailure = createStatefulTransport({ writeError: true });
  await assert.rejects(
    () => persistence(writeFailure).create({ state: STATE, codeVerifier: CODE_VERIFIER, createdAtMs: NOW_MS }),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_FAILED', ['private-write-provider-detail', STATE]),
  );

  const commitUnknown = createStatefulTransport({ commitUnknown: true });
  await assert.rejects(
    () => persistence(commitUnknown).issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: EXPIRES_AT_MS }),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_FAILED', ['private-commit-provider-detail']),
  );
  assert.equal(commitUnknown.sessionEntries().length, 0);
});

test('session issuance rejects invalid role/time/random boundaries before pretending success', async () => {
  const fake = createStatefulTransport();
  const store = persistence(fake);

  await assert.rejects(
    () => store.issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: NOW_MS + 1000 }),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_INVALID'),
  );
  await assert.rejects(
    () => store.revoke(' malformed-handle'),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_INVALID', ['malformed-handle']),
  );

  const badRandom = persistence(createStatefulTransport(), { random: { randomBytes: () => new Uint8Array(31) } });
  await assert.rejects(
    () => badRandom.issue({ role: 'OWNER', issuedAtMs: NOW_MS, expiresAtMs: EXPIRES_AT_MS }),
    (error) => assertSafeError(error, 'AUTH_PERSISTENCE_INVALID'),
  );
});
