/**
 * Read-only parser for the Russian fiscal receipt QR payload.
 *
 * This module never calls a receipt API or mutates the financial ledger.
 * It must not be used as evidence that itemized receipt data was retrieved.
 */
export class FiscalQrError extends Error {
  constructor(message) {
    super(message);
    this.name = "FiscalQrError";
  }
}

const REQUIRED = ["t", "s", "fn", "i", "fp", "n"];
const OPERATION_LABELS = Object.freeze({
  "1": "Приход",
  "2": "Возврат прихода",
  "3": "Расход",
  "4": "Возврат расхода",
});

function fail(message) {
  throw new FiscalQrError(message);
}

function parseTimestamp(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/i.exec(value);
  if (!match) fail("Неверная дата или время в QR-коде.");
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const seconds = Number.isFinite(second) ? second : 0;
  const test = new Date(Date.UTC(year, month - 1, day, hour, minute, seconds));
  if (
    year < 2000 || year > 2100 ||
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() + 1 !== month ||
    test.getUTCDate() !== day ||
    test.getUTCHours() !== hour ||
    test.getUTCMinutes() !== minute ||
    test.getUTCSeconds() !== seconds
  ) fail("В QR-коде указана невозможная дата или время.");
  const date = [match[1], match[2], match[3]].join("-");
  const time = [match[4], match[5]].join(":") +
    (match[6] ? ":" + match[6] : "");
  return { occurredOn: date, receiptLocalTime: time };
}

function parseAmount(value) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) fail("Неверная сумма в QR-коде.");
  const minor = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    fail("Сумма чека должна быть положительной.");
  }
  return minor;
}

/**
 * @param {string} payload Raw QR text, for example
 *  t=20261015T1840&s=125.50&fn=1234567890123456&i=1&fp=123456789&n=1
 */
export function parseFiscalQr(payload) {
  if (typeof payload !== "string" || !payload.trim()) {
    fail("Передайте текст QR-кода.");
  }
  const raw = payload.trim();
  if (raw.length > 1024) fail("QR-код слишком длинный.");

  const fields = Object.create(null);
  for (const part of raw.split("&")) {
    const separator = part.indexOf("=");
    if (separator < 1 || separator === part.length - 1) {
      fail("Неверная структура QR-кода.");
    }
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!/^[a-z]+$/i.test(key)) fail("Неверное имя поля QR-кода.");
    if (Object.hasOwn(fields, key)) fail("Повторяющееся поле QR-кода: " + key);
    fields[key] = value;
  }
  for (const key of REQUIRED) {
    if (!fields[key]) fail("В QR-коде отсутствует обязательное поле " + key + ".");
  }
  if (!/^\d{16}$/.test(fields.fn)) fail("Неверный номер фискального накопителя.");
  if (!/^[1-9]\d{0,14}$/.test(fields.i)) fail("Неверный номер фискального документа.");
  if (!/^[1-9]\d{0,19}$/.test(fields.fp)) fail("Неверный фискальный признак.");
  if (!Object.hasOwn(OPERATION_LABELS, fields.n)) {
    fail("Неизвестный признак расчёта.");
  }

  const timestamp = parseTimestamp(fields.t);
  const amountMinor = parseAmount(fields.s);
  return Object.freeze({
    ...timestamp,
    amountMinor,
    amountRub: (amountMinor / 100).toFixed(2),
    fiscalDriveNumber: fields.fn,
    fiscalDocumentNumber: fields.i,
    fiscalSign: fields.fp,
    operationCode: fields.n,
    operationLabel: OPERATION_LABELS[fields.n],
    receiptKey: [fields.fn, fields.i, fields.fp].join(":"),
    rawQr: raw,
  });
}
