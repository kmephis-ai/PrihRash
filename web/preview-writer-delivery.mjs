import { parsePreviewExpenseIntent } from './preview-writer-outbox.mjs';

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
    throw new Error('INVALID_PREVIEW_EXPENSE_ACK');
  }
  return value;
}

export function createPreviewExpenseCreateApiRequest(intent) {
  const safe = parsePreviewExpenseIntent(intent);
  return Object.freeze({
    idempotencyKey: safe.intentId,
    occurredOn: safe.payload.occurredOn,
    amountMinor: safe.payload.amountMinor,
    currency: 'RUB',
    fromAccountId: safe.payload.fromAccount.id,
    categoryId: safe.payload.category.id,
    description: safe.payload.description,
    note: safe.payload.note,
  });
}

export function parsePreviewExpenseCreateAck(value, expectedIntentId) {
  const expected = canonicalUuid(expectedIntentId);
  if (!exactKeys(value, ['apiVersion', 'outcome', 'idempotencyKey', 'transactionId', 'version'])) {
    throw new Error('INVALID_PREVIEW_EXPENSE_ACK');
  }
  if (value.apiVersion !== API_VERSION || (value.outcome !== 'CREATED' && value.outcome !== 'REPLAY')) {
    throw new Error('INVALID_PREVIEW_EXPENSE_ACK');
  }
  const idempotencyKey = canonicalUuid(value.idempotencyKey);
  const transactionId = canonicalUuid(value.transactionId);
  if (idempotencyKey !== expected || transactionId === idempotencyKey || value.version !== 1) {
    throw new Error('INVALID_PREVIEW_EXPENSE_ACK');
  }
  return Object.freeze({
    apiVersion: API_VERSION,
    outcome: value.outcome,
    idempotencyKey,
    transactionId,
    version: 1,
  });
}

export async function deliverPreviewExpenseIntent({ outbox, sender, intent }) {
  if (!outbox || typeof outbox.acknowledge !== 'function' || !sender || typeof sender.sendExpenseCreate !== 'function') {
    throw new Error('PREVIEW_EXPENSE_DELIVERY_UNAVAILABLE');
  }
  const request = createPreviewExpenseCreateApiRequest(intent);
  let response;
  try {
    response = await sender.sendExpenseCreate(request);
  } catch {
    throw new Error('PREVIEW_EXPENSE_SEND_FAILED');
  }
  const ack = parsePreviewExpenseCreateAck(response, request.idempotencyKey);
  try {
    await outbox.acknowledge(request.idempotencyKey);
  } catch {
    throw new Error('PREVIEW_EXPENSE_LOCAL_ACK_FAILED');
  }
  return ack;
}

export const previewExpenseDeliveryContract = Object.freeze({ apiVersion: API_VERSION });
