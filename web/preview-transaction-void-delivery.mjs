import { parsePreviewVoidIntent } from './preview-writer-outbox.mjs';

const VOID_API_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function invalidAck() {
  throw new Error('INVALID_PREVIEW_VOID_ACK');
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalUuid(value, fail = invalidAck) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail();
  return value;
}

function positiveSafeVersion(value, fail = invalidAck) {
  if (!Number.isSafeInteger(value) || value <= 0) fail();
  return value;
}

export function createPreviewTransactionVoidRequest(intent) {
  const safe = parsePreviewVoidIntent(intent);
  return Object.freeze({
    transactionId: safe.payload.transactionId,
    expectedVersion: safe.payload.expectedVersion,
  });
}

export function parsePreviewTransactionVoidAck(value, request) {
  if (!exactKeys(request, ['transactionId', 'expectedVersion'])) invalidAck();
  const expectedTransactionId = canonicalUuid(request.transactionId);
  const expectedVersion = positiveSafeVersion(request.expectedVersion);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.apiVersion !== VOID_API_VERSION) invalidAck();
  if (value.outcome === 'VOIDED' || value.outcome === 'ALREADY_VOIDED') {
    if (!exactKeys(value, ['apiVersion', 'outcome', 'transactionId', 'version'])) invalidAck();
    const transactionId = canonicalUuid(value.transactionId);
    if (transactionId !== expectedTransactionId) invalidAck();
    const version = positiveSafeVersion(value.version);
    const wantedVersion = value.outcome === 'VOIDED' ? expectedVersion + 1 : expectedVersion;
    if (!Number.isSafeInteger(wantedVersion) || version !== wantedVersion) invalidAck();
    return Object.freeze({ apiVersion: VOID_API_VERSION, outcome: value.outcome, transactionId, version });
  }
  if (value.outcome === 'VERSION_CONFLICT') {
    if (!exactKeys(value, ['apiVersion', 'outcome', 'transactionId', 'currentVersion'])) invalidAck();
    const transactionId = canonicalUuid(value.transactionId);
    if (transactionId !== expectedTransactionId) invalidAck();
    const currentVersion = positiveSafeVersion(value.currentVersion);
    if (currentVersion === expectedVersion) invalidAck();
    return Object.freeze({ apiVersion: VOID_API_VERSION, outcome: 'VERSION_CONFLICT', transactionId, currentVersion });
  }
  invalidAck();
}

export async function deliverPreviewTransactionVoidIntent({ outbox, sender, intent }) {
  if (!outbox || typeof outbox.acknowledge !== 'function' || !sender || typeof sender.sendTransactionVoid !== 'function') {
    throw new Error('PREVIEW_VOID_DELIVERY_UNAVAILABLE');
  }
  const safeIntent = parsePreviewVoidIntent(intent);
  const request = createPreviewTransactionVoidRequest(safeIntent);
  let response;
  try {
    response = await sender.sendTransactionVoid(request);
  } catch {
    throw new Error('PREVIEW_VOID_SEND_FAILED');
  }
  const ack = parsePreviewTransactionVoidAck(response, request);
  if (ack.outcome === 'VERSION_CONFLICT') return ack;
  try {
    await outbox.acknowledge(safeIntent.intentId);
  } catch {
    throw new Error('PREVIEW_VOID_LOCAL_ACK_FAILED');
  }
  return ack;
}
