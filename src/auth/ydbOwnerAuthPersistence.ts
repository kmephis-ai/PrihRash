import { createHash, randomBytes as secureRandomBytes } from 'node:crypto';

import {
  OWNER_SESSION_MAX_TTL_SECONDS,
  OWNER_SESSION_MIN_TTL_SECONDS,
  type OwnerSessionIssuer,
  type OwnerSessionRevoker,
  type OwnerSessionVerification,
  type OwnerSessionVerifier,
  type YandexOwnerOAuthTransaction,
  type YandexOwnerOAuthTransactionStore,
} from './yandexOwnerOAuthFlow.js';
import {
  readStatement,
  writeStatement,
  YdbAdapter,
  type YdbQueryResult,
  type YdbTransaction,
} from '../integration/ydb/adapter.js';
import { uint64Parameter, utf8Parameter } from '../integration/ydb/parameters.js';

const GENERATED_SECRET_BYTES = 32;
const GENERATED_BASE64URL_LENGTH = 43;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type OwnerAuthPersistenceErrorCode =
  | 'AUTH_PERSISTENCE_INVALID'
  | 'AUTH_PERSISTENCE_EVIDENCE_INVALID'
  | 'AUTH_PERSISTENCE_FAILED';

export class OwnerAuthPersistenceError extends Error {
  readonly code: OwnerAuthPersistenceErrorCode;

  constructor(code: OwnerAuthPersistenceErrorCode) {
    super(code);
    this.name = 'OwnerAuthPersistenceError';
    this.code = code;
  }
}

export interface OwnerAuthPersistenceRandomSource {
  randomBytes(size: number): Uint8Array;
}

interface OAuthTransactionRow {
  readonly code_verifier?: unknown;
  readonly created_at_ms?: unknown;
}

interface OwnerSessionRow {
  readonly role?: unknown;
  readonly issued_at_ms?: unknown;
  readonly expires_at_ms?: unknown;
}

const SYSTEM_RANDOM: Readonly<OwnerAuthPersistenceRandomSource> = Object.freeze({
  randomBytes: (size: number) => secureRandomBytes(size),
});

function invalid(): never {
  throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_INVALID');
}

function evidenceInvalid(): never {
  throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_EVIDENCE_INVALID');
}

function isGeneratedState(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === GENERATED_BASE64URL_LENGTH
    && BASE64URL_PATTERN.test(value);
}

function isCodeVerifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 43
    && value.length <= 128
    && CODE_VERIFIER_PATTERN.test(value);
}

function isSessionHandle(value: unknown): value is string {
  return typeof value === 'string'
    && value.length === GENERATED_BASE64URL_LENGTH
    && BASE64URL_PATTERN.test(value);
}

function safeUint64Number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function requireNowMs(value: unknown): number {
  const parsed = safeUint64Number(value);
  if (parsed === null) return invalid();
  return parsed;
}

function sha256Hex(value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  if (!SHA256_HEX_PATTERN.test(digest)) throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_FAILED');
  return digest;
}

function generatedSessionHandle(random: Readonly<OwnerAuthPersistenceRandomSource>): string {
  let bytes: Uint8Array;
  try {
    bytes = random.randomBytes(GENERATED_SECRET_BYTES);
  } catch {
    throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_FAILED');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== GENERATED_SECRET_BYTES) return invalid();
  const handle = Buffer.from(bytes).toString('base64url');
  if (!isSessionHandle(handle)) throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_FAILED');
  return handle;
}

function normalizeTransaction(value: Readonly<YandexOwnerOAuthTransaction>): Readonly<YandexOwnerOAuthTransaction> {
  if (!isGeneratedState(value.state) || !isCodeVerifier(value.codeVerifier)) return invalid();
  const createdAtMs = requireNowMs(value.createdAtMs);
  return Object.freeze({ state: value.state, codeVerifier: value.codeVerifier, createdAtMs });
}

function normalizeSessionIssue(input: Readonly<{
  role: 'OWNER';
  issuedAtMs: number;
  expiresAtMs: number;
}>): Readonly<{ role: 'OWNER'; issuedAtMs: number; expiresAtMs: number }> {
  if (input.role !== 'OWNER') return invalid();
  const issuedAtMs = requireNowMs(input.issuedAtMs);
  const expiresAtMs = requireNowMs(input.expiresAtMs);
  const ttlMs = expiresAtMs - issuedAtMs;
  if (
    ttlMs < OWNER_SESSION_MIN_TTL_SECONDS * 1000
    || ttlMs > OWNER_SESSION_MAX_TTL_SECONDS * 1000
  ) return invalid();
  return Object.freeze({ role: 'OWNER' as const, issuedAtMs, expiresAtMs });
}

function oneRow<Row>(result: Readonly<YdbQueryResult<Row>>): Readonly<Row> | null {
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) return evidenceInvalid();
  const row = result.rows[0];
  if (row === undefined) return evidenceInvalid();
  return row;
}

function parseTransactionRow(row: Readonly<OAuthTransactionRow>, state: string): Readonly<YandexOwnerOAuthTransaction> {
  if (!isCodeVerifier(row.code_verifier)) return evidenceInvalid();
  const createdAtMs = safeUint64Number(row.created_at_ms);
  if (createdAtMs === null) return evidenceInvalid();
  return Object.freeze({ state, codeVerifier: row.code_verifier, createdAtMs });
}

function parseSessionRow(row: Readonly<OwnerSessionRow>, nowMs: number): Readonly<OwnerSessionVerification> | null {
  if (row.role !== 'OWNER') return evidenceInvalid();
  const issuedAtMs = safeUint64Number(row.issued_at_ms);
  const expiresAtMs = safeUint64Number(row.expires_at_ms);
  if (issuedAtMs === null || expiresAtMs === null || expiresAtMs <= issuedAtMs) return evidenceInvalid();
  if (nowMs < issuedAtMs || nowMs >= expiresAtMs) return null;
  return Object.freeze({ role: 'OWNER' as const, expiresAtMs });
}

function transactionReadStatement(stateHash: string) {
  return readStatement(
    'SELECT code_verifier, created_at_ms FROM owner_oauth_transactions WHERE state_hash = $state_hash LIMIT 1',
    Object.freeze({ state_hash: utf8Parameter(stateHash) }),
  );
}

function transactionDeleteStatement(stateHash: string) {
  return writeStatement(
    'DELETE FROM owner_oauth_transactions WHERE state_hash = $state_hash',
    Object.freeze({ state_hash: utf8Parameter(stateHash) }),
  );
}

function sessionReadStatement(sessionHash: string) {
  return readStatement(
    'SELECT role, issued_at_ms, expires_at_ms FROM owner_sessions WHERE session_hash = $session_hash LIMIT 1',
    Object.freeze({ session_hash: utf8Parameter(sessionHash) }),
  );
}

function sessionDeleteStatement(sessionHash: string) {
  return writeStatement(
    'DELETE FROM owner_sessions WHERE session_hash = $session_hash',
    Object.freeze({ session_hash: utf8Parameter(sessionHash) }),
  );
}

async function safeTransaction<T>(
  adapter: YdbAdapter,
  work: (transaction: YdbTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await adapter.serializableReadWrite(work);
  } catch (error) {
    if (error instanceof OwnerAuthPersistenceError) throw error;
    throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_FAILED');
  }
}

async function safeRead<Row>(adapter: YdbAdapter, statement: ReturnType<typeof readStatement>): Promise<YdbQueryResult<Row>> {
  try {
    return await adapter.read<Row>(statement);
  } catch (error) {
    if (error instanceof OwnerAuthPersistenceError) throw error;
    throw new OwnerAuthPersistenceError('AUTH_PERSISTENCE_FAILED');
  }
}

export class YdbOwnerAuthPersistence implements
  YandexOwnerOAuthTransactionStore,
  OwnerSessionIssuer,
  OwnerSessionRevoker,
  OwnerSessionVerifier {
  readonly #adapter: YdbAdapter;
  readonly #random: Readonly<OwnerAuthPersistenceRandomSource>;

  constructor(
    adapter: YdbAdapter,
    options: Readonly<{ random?: OwnerAuthPersistenceRandomSource }> = {},
  ) {
    this.#adapter = adapter;
    this.#random = options.random ?? SYSTEM_RANDOM;
  }

  async create(transaction: Readonly<YandexOwnerOAuthTransaction>): Promise<void> {
    const safe = normalizeTransaction(transaction);
    const stateHash = sha256Hex(safe.state);
    await safeTransaction(this.#adapter, async (tx) => {
      await tx.execute(writeStatement(
        'INSERT INTO owner_oauth_transactions (state_hash, code_verifier, created_at_ms) '
          + 'VALUES ($state_hash, $code_verifier, $created_at_ms)',
        Object.freeze({
          state_hash: utf8Parameter(stateHash),
          code_verifier: utf8Parameter(safe.codeVerifier),
          created_at_ms: uint64Parameter(safe.createdAtMs),
        }),
      ));
    });
  }

  async consume(state: string): Promise<Readonly<YandexOwnerOAuthTransaction> | null> {
    if (!isGeneratedState(state)) return invalid();
    const stateHash = sha256Hex(state);
    return safeTransaction(this.#adapter, async (tx) => {
      const result = await tx.read<OAuthTransactionRow>(transactionReadStatement(stateHash));
      const row = oneRow(result);
      if (row === null) return null;
      const parsed = parseTransactionRow(row, state);
      await tx.execute(transactionDeleteStatement(stateHash));
      return parsed;
    });
  }

  async issue(input: Readonly<{
    role: 'OWNER';
    issuedAtMs: number;
    expiresAtMs: number;
  }>): Promise<string> {
    const safe = normalizeSessionIssue(input);
    const sessionHandle = generatedSessionHandle(this.#random);
    const sessionHash = sha256Hex(sessionHandle);
    await safeTransaction(this.#adapter, async (tx) => {
      await tx.execute(writeStatement(
        'INSERT INTO owner_sessions (session_hash, role, issued_at_ms, expires_at_ms) '
          + 'VALUES ($session_hash, $role, $issued_at_ms, $expires_at_ms)',
        Object.freeze({
          session_hash: utf8Parameter(sessionHash),
          role: utf8Parameter('OWNER'),
          issued_at_ms: uint64Parameter(safe.issuedAtMs),
          expires_at_ms: uint64Parameter(safe.expiresAtMs),
        }),
      ));
    });
    return sessionHandle;
  }

  async verify(sessionHandle: string, nowMs: number): Promise<Readonly<OwnerSessionVerification> | null> {
    if (!isSessionHandle(sessionHandle)) return null;
    const safeNowMs = requireNowMs(nowMs);
    const sessionHash = sha256Hex(sessionHandle);
    const result = await safeRead<OwnerSessionRow>(this.#adapter, sessionReadStatement(sessionHash));
    const row = oneRow(result);
    return row === null ? null : parseSessionRow(row, safeNowMs);
  }

  async revoke(sessionHandle: string): Promise<void> {
    if (!isSessionHandle(sessionHandle)) return invalid();
    const sessionHash = sha256Hex(sessionHandle);
    await safeTransaction(this.#adapter, async (tx) => {
      await tx.execute(sessionDeleteStatement(sessionHash));
    });
  }
}
