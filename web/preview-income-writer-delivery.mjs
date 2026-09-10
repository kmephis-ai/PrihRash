import { parsePreviewIncomeIntent } from './preview-writer-outbox.mjs';

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
    throw new Error('INVALID_PREVIEW_INCOME_ACK');
  }
  return value;
}

export function createPreviewIncomeCreateApiRequest(intent) {
  const safe = parsePreviewIncomeIntent(intent);
  return Object.freeze({
    idempotencyKey: safe.intentId,
    occurredOn: safe.payload.occurredOn,
    amountMinor: safe.payload.amountMinor,
    currency: 'RUB',
    toAccountId: safe.payload.toAccount.id,
    categoryId: safe.payload.category.id,
    description: safe.payload.description,
    note: safe.payload.note,
  });
}

export function parsePreviewIncomeCreateAck(value, expectedIntentId) {
  const expected = canonicalUuid(expectedIntentId);
  if (!exactKeys(value, ['apiVersion', 'outcome', 'idempotencyKey', 'transactionId', 'version'])) {
    throw new Error('INVALID_PREVIEW_INCOME_ACK');
  }
  if (value.apiVersion !== API_VERSION || (value.outcome !== 'CREATED' && value.outcome !== 'REPLAY')) {
    throw new Error('INVALID_PREVIEW_INCOME_ACK');
  }
  const idempotencyKey = canonicalUuid(value.idempotencyKey);
  const transactionId = canonicalUuid(value.transactionId);
  if (idempotencyKey !== expected || transactionId === idempotencyKey || value.version !== 1) {
    throw new Error('INVALID_PREVIEW_INCOME_ACK');
  }
  return Object.freeze({
    apiVersion: API_VERSION,
    outcome: value.outcome,
    idempotencyKey,
    transactionId,
    version: 1,
  });
}

export async function deliverPreviewIncomeIntent({ outbox, sender, intent }) {
  if (!outbox || typeof outbox.acknowledge !== 'function' || !sender || typeof sender.sendIncomeCreate !== 'function') {
    throw new Error('PREVIEW_INCOME_DELIVERY_UNAVAILABLE');
  }
  const request = createPreviewIncomeCreateApiRequest(intent);
  let response;
  try {
    response = await sender.sendIncomeCreate(request);
  } catch {
    throw new Error('PREVIEW_INCOME_SEND_FAILED');
  }
  const ack = parsePreviewIncomeCreateAck(response, request.idempotencyKey);
  try {
    await outbox.acknowledge(request.idempotencyKey);
  } catch {
    throw new Error('PREVIEW_INCOME_LOCAL_ACK_FAILED');
  }
  return ack;
}

export const previewIncomeDeliveryContract = Object.freeze({ apiVersion: API_VERSION });
