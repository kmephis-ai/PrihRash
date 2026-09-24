const YDB_DATABASES_API = 'https://ydb.api.cloud.yandex.net/ydb/v1/databases' as const;
const UPDATE_MASK = 'serverlessDatabase.throttlingRcuLimit' as const;
const INITIAL_LIMIT = 10 as const;
const TEMPORARY_LIMIT = 14 as const;
const OPERATION_POLL_LIMIT = 150;
const OPERATION_POLL_MS = 2_000;

type Action = 'READ' | 'SET_14' | 'RESTORE_10';
type UnknownRecord = Readonly<Record<string, unknown>>;

export interface Wu7TemporaryThrottlingEnvironment {
  readonly PRIHRASH_YC_FOLDER_ID?: string;
  readonly PRIHRASH_YDB_CONNECTION_STRING?: string;
}

export interface Wu7FunctionContext {
  readonly token?: unknown;
}

export interface Wu7ThrottlingFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface Wu7Sleep {
  (milliseconds: number): Promise<void>;
}
export type Wu7TemporaryThrottlingResult =
  | Readonly<{
      status: 'PASS';
      code: 'WU7_THROTTLING_STATE_CLASSIFIED';
      throttlingEnabled: true;
      throttlingRcuLimit: 10 | 14;
      provisionedRcuLimit: 0;
    }>
  | Readonly<{ status: 'PASS'; code: 'WU7_THROTTLING_SET_14' }>
  | Readonly<{ status: 'PASS'; code: 'WU7_THROTTLING_RESTORED_10' }>
  | Readonly<{
      status: 'STOP';
      code: 'WU7_THROTTLING_GATE_STOP';
      stage:
        | 'CONFIG_INVALID'
        | 'EVENT_INVALID'
        | 'READ_FAILED'
        | 'IDENTITY_MISMATCH'
        | 'STATE_NOT_EXACT'
        | 'UPDATE_FAILED'
        | 'UPDATE_UNKNOWN'
        | 'UPDATE_AUTH'
        | 'UPDATE_NOT_FOUND'
        | 'UPDATE_TRANSPORT'
        | 'UPDATE_MALFORMED'
        | 'UPDATE_NOT_TERMINAL'
        | 'READBACK_MISMATCH';
    }>;

interface ExactState {
  readonly databaseId: string;
  readonly throttlingEnabled: true;
  readonly throttlingRcuLimit: 10 | 14;
  readonly provisionedRcuLimit: 0;
}
function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function parseNonnegativeInteger(value: unknown, omittedDefault: number): number | null {
  if (value === undefined) return omittedDefault;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseConnectionDatabaseId(connectionString: unknown): string | null {
  if (!nonBlank(connectionString)) return null;
  let url: URL;
  try { url = new URL(connectionString); } catch { return null; }
  if (url.protocol !== 'grpcs:' || url.username || url.password || url.hash) return null;
  const values = url.searchParams.getAll('database');
  if (values.length !== 1 || !nonBlank(values[0])) return null;
  const segments = values[0].split('/');
  if (segments.length !== 4 || segments[0] !== '') return null;
  for (const segment of segments.slice(1)) {
    if (!/^[a-z0-9-]+$/u.test(segment)) return null;
  }
  const databaseId = segments[3];
  return nonBlank(databaseId) ? databaseId : null;
}

function accessToken(context: unknown): string | null {
  const root = record(context);
  const token = root === null ? null : record(root.token);
  return token !== null && nonBlank(token.access_token) ? token.access_token : null;
}

function requestedAction(event: unknown): Action | null {
  const value = record(event);
  if (value === null) return null;
  return value.action === 'READ' || value.action === 'SET_14' || value.action === 'RESTORE_10'
    ? value.action
    : null;
}

function stop(stage: Extract<Wu7TemporaryThrottlingResult, { status: 'STOP' }>['stage']) {
  return Object.freeze({
    status: 'STOP' as const,
    code: 'WU7_THROTTLING_GATE_STOP' as const,
    stage,
  });
}

async function jsonResponse(
  fetchImpl: Wu7ThrottlingFetch,
  input: string | URL,
  init: RequestInit,
): Promise<{ readonly ok: boolean; readonly status: number | null; readonly value: UnknownRecord | null }> {
  let response: Response;
  try { response = await fetchImpl(input, init); } catch {
    return { ok: false, status: null, value: null };
  }
  if (!response.ok) return { ok: false, status: response.status, value: null };
  let value: unknown;
  try { value = await response.json(); } catch {
    return { ok: false, status: response.status, value: null };
  }
  return { ok: true, status: response.status, value: record(value) };
}

async function readExactState(
  databaseId: string,
  folderId: string,
  token: string,
  fetchImpl: Wu7ThrottlingFetch,
): Promise<ExactState | 'READ_FAILED' | 'IDENTITY_MISMATCH' | 'STATE_NOT_EXACT'> {
  const result = await jsonResponse(
    fetchImpl,
    `${YDB_DATABASES_API}/${encodeURIComponent(databaseId)}`,
    { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error' },
  );
  if (!result.ok || result.value === null) return 'READ_FAILED';
  if (result.value.id !== databaseId || result.value.folderId !== folderId) return 'IDENTITY_MISMATCH';
  const serverless = record(result.value.serverlessDatabase);
  if (serverless === null) return 'STATE_NOT_EXACT';
  const enabled = serverless.enableThrottlingRcuLimit === undefined
    ? false
    : serverless.enableThrottlingRcuLimit;
  const throttling = parseNonnegativeInteger(serverless.throttlingRcuLimit, 0);
  const provisioned = parseNonnegativeInteger(serverless.provisionedRcuLimit, 0);
  if (
    enabled !== true
    || (throttling !== INITIAL_LIMIT && throttling !== TEMPORARY_LIMIT)
    || provisioned !== 0
  ) return 'STATE_NOT_EXACT';
  return Object.freeze({
    databaseId,
    throttlingEnabled: true as const,
    throttlingRcuLimit: throttling,
    provisionedRcuLimit: 0 as const,
  });
}

async function updateLimit(
  state: ExactState,
  folderId: string,
  token: string,
  target: 10 | 14,
  fetchImpl: Wu7ThrottlingFetch,
  sleep: Wu7Sleep,
): Promise<
  'DONE'
  | 'FAILED'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'TRANSPORT'
  | 'MALFORMED'
  | 'NOT_TERMINAL'
> {
  const idempotencyKey = crypto.randomUUID();
  const body = JSON.stringify({
    folderId,
    updateMask: UPDATE_MASK,
    serverlessDatabase: { throttlingRcuLimit: String(target) },
  });
  let operationId: string | null = null;
  let observedNonTerminal = false;
  let observedTransportFailure = false;

  for (let attempt = 0; attempt < OPERATION_POLL_LIMIT; attempt += 1) {
    const result = await jsonResponse(
      fetchImpl,
      `${YDB_DATABASES_API}/${encodeURIComponent(state.databaseId)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        redirect: 'error',
        body,
      },
    );

    if (!result.ok || result.value === null) {
      if (result.status === 401 || result.status === 403) return 'AUTH';
      if (result.status === 404) return 'NOT_FOUND';
      if (result.status !== null && result.status >= 400 && result.status < 500) return 'MALFORMED';
      observedTransportFailure = true;
      await sleep(OPERATION_POLL_MS);
      continue;
    }

    if (!nonBlank(result.value.id)) return 'MALFORMED';
    if (operationId === null) operationId = result.value.id;
    else if (result.value.id !== operationId) return 'MALFORMED';

    const done = result.value.done === undefined ? false : result.value.done;
    if (done === true) {
      const hasError = result.value.error !== undefined;
      const hasResponse = result.value.response !== undefined;
      if (hasError === hasResponse) return 'MALFORMED';
      return hasError ? 'FAILED' : 'DONE';
    }
    if (done !== false) return 'MALFORMED';
    // Managed YDB may populate response before done=true. It is not terminal proof.
    if (result.value.response !== undefined && (
      record(result.value.response) === null || result.value.error !== undefined
    )) return 'MALFORMED';

    observedNonTerminal = true;
    await sleep(OPERATION_POLL_MS);
  }

  if (observedNonTerminal) return 'NOT_TERMINAL';
  return observedTransportFailure ? 'TRANSPORT' : 'MALFORMED';
}

export async function executeWu7TemporaryThrottlingGate(
  event: unknown,
  environment: Wu7TemporaryThrottlingEnvironment,
  context: Wu7FunctionContext | unknown,
  fetchImpl: Wu7ThrottlingFetch = (input, init) => fetch(input, init),
  sleep: Wu7Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Readonly<Wu7TemporaryThrottlingResult>> {
  const action = requestedAction(event);
  if (action === null) return stop('EVENT_INVALID');
  const folderId = environment.PRIHRASH_YC_FOLDER_ID;
  const databaseId = parseConnectionDatabaseId(environment.PRIHRASH_YDB_CONNECTION_STRING);
  const token = accessToken(context);
  if (!nonBlank(folderId) || databaseId === null || token === null) return stop('CONFIG_INVALID');

  const before = await readExactState(databaseId, folderId, token, fetchImpl);
  if (before === 'READ_FAILED') return stop('READ_FAILED');
  if (before === 'IDENTITY_MISMATCH') return stop('IDENTITY_MISMATCH');
  if (before === 'STATE_NOT_EXACT') return stop('STATE_NOT_EXACT');

  if (action === 'READ') {
    return Object.freeze({
      status: 'PASS' as const,
      code: 'WU7_THROTTLING_STATE_CLASSIFIED' as const,
      throttlingEnabled: true as const,
      throttlingRcuLimit: before.throttlingRcuLimit,
      provisionedRcuLimit: 0 as const,
    });
  }

  const target = action === 'SET_14' ? TEMPORARY_LIMIT : INITIAL_LIMIT;
  if (action === 'SET_14' && before.throttlingRcuLimit !== INITIAL_LIMIT) {
    return stop('STATE_NOT_EXACT');
  }
  if (action === 'RESTORE_10' && before.throttlingRcuLimit === INITIAL_LIMIT) {
    return Object.freeze({ status: 'PASS' as const, code: 'WU7_THROTTLING_RESTORED_10' as const });
  }
  const updated = await updateLimit(before, folderId, token, target, fetchImpl, sleep);
  if (updated === 'FAILED') return stop('UPDATE_FAILED');
  if (updated === 'AUTH') return stop('UPDATE_AUTH');
  if (updated === 'NOT_FOUND') return stop('UPDATE_NOT_FOUND');
  if (updated === 'TRANSPORT') return stop('UPDATE_TRANSPORT');
  if (updated === 'MALFORMED') return stop('UPDATE_MALFORMED');
  if (updated === 'NOT_TERMINAL') return stop('UPDATE_NOT_TERMINAL');

  const after = await readExactState(databaseId, folderId, token, fetchImpl);
  if (after === 'READ_FAILED') return stop('UPDATE_UNKNOWN');
  if (after === 'IDENTITY_MISMATCH') return stop('IDENTITY_MISMATCH');
  if (after === 'STATE_NOT_EXACT' || after.throttlingRcuLimit !== target) return stop('READBACK_MISMATCH');

  return action === 'SET_14'
    ? Object.freeze({ status: 'PASS' as const, code: 'WU7_THROTTLING_SET_14' as const })
    : Object.freeze({ status: 'PASS' as const, code: 'WU7_THROTTLING_RESTORED_10' as const });
}

export async function wu7TemporaryThrottlingHandler(
  event: unknown,
  context: unknown,
): Promise<Readonly<Wu7TemporaryThrottlingResult>> {
  return executeWu7TemporaryThrottlingGate(event, process.env, context);
}
