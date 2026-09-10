import { parsePreviewTransferIntent } from './preview-writer-outbox.mjs';

const API_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('INVALID_PREVIEW_TRANSFER_ACK');
  }
  return value;
}

export function createPreviewTransferCreateApiRequest(intent) {
  const safe = parsePreviewTransferIntent(intent);
  return Object.freeze({
    idempotencyKey: safe.intentId,
    occurredOn: safe.payload.occurredOn,
    amountMinor: safe.payload.amountMinor,
    currency: 'RUB',
    fromAccountId: safe.payload.fromAccount.id,
    toAccountId: safe.payload.toAccount.id,
    description: safe.payload.description,
    note: safe.payload.note,
  });
}

export function parsePreviewTransferCreateAck(value, expectedIntentId) {
  const expected = canonicalUuid(expectedIntentId);
  if (!exactKeys(value, ['apiVersion', 'outcome', 'idempotencyKey', 'transactionId', 'version'])) {
    throw new Error('INVALID_PREVIEW_TRANSFER_ACK');
  }
  if (value.apiVersion !== API_VERSION || (value.outcome !== 'CREATED' && value.outcome !== 'REPLAY')) {
    throw new Error('INVALID_PREVIEW_TRANSFER_ACK');
  }
  const idempotencyKey = canonicalUuid(value.idempotencyKey);
  const transactionId = canonicalUuid(value.transactionId);
  if (idempotencyKey !== expected || transactionId === idempotencyKey || value.version !== 1) {
    throw new Error('INVALID_PREVIEW_TRANSFER_ACK');
  }
  return Object.freeze({
    apiVersion: API_VERSION,
    outcome: value.outcome,
    idempotencyKey,
    transactionId,
    version: 1,
  });
}

export async function deliverPreviewTransferIntent({ outbox, sender, intent }) {
  if (!outbox || typeof outbox.acknowledge !== 'function' || !sender || typeof sender.sendTransferCreate !== 'function') {
    throw new Error('PREVIEW_TRANSFER_DELIVERY_UNAVAILABLE');
  }
  const request = createPreviewTransferCreateApiRequest(intent);
  let response;
  try {
    response = await sender.sendTransferCreate(request);
  } catch {
    throw new Error('PREVIEW_TRANSFER_SEND_FAILED');
  }
  const ack = parsePreviewTransferCreateAck(response, request.idempotencyKey);
  try {
    await outbox.acknowledge(request.idempotencyKey);
  } catch {
    throw new Error('PREVIEW_TRANSFER_LOCAL_ACK_FAILED');
  }
  return ack;
}

export const previewTransferDeliveryContract = Object.freeze({ apiVersion: API_VERSION });
