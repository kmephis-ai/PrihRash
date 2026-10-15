import assert from "node:assert/strict";
import test from "node:test";
import { FiscalQrError, parseFiscalQr } from "../../web/qr/fiscal-qr.mjs";

const VALID = "t=20261015T1840&s=125.50&fn=1234567890123456&i=72&fp=987654321&n=1";

test("parses a valid Russian receipt QR without a network call", () => {
  const value = parseFiscalQr(VALID);
  assert.equal(value.occurredOn, "2026-10-15");
  assert.equal(value.receiptLocalTime, "18:40");
  assert.equal(value.amountMinor, 12550);
  assert.equal(value.amountRub, "125.50");
  assert.equal(value.operationLabel, "Приход");
  assert.equal(value.receiptKey, "1234567890123456:72:987654321");
});

test("preserves kopecks without floating-point arithmetic", () => {
  assert.equal(parseFiscalQr(VALID.replace("125.50", "0.01")).amountMinor, 1);
  assert.equal(parseFiscalQr(VALID.replace("125.50", "19.9")).amountMinor, 1990);
});

test("accepts a valid timestamp with seconds and a refund", () => {
  const value = parseFiscalQr(VALID.replace("T1840", "T184059").replace("&n=1", "&n=2"));
  assert.equal(value.receiptLocalTime, "18:40:59");
  assert.equal(value.operationLabel, "Возврат прихода");
});

test("rejects missing fiscal attributes", () => {
  assert.throws(() => parseFiscalQr(VALID.replace("&fp=987654321", "")), FiscalQrError);
});

test("rejects duplicate fields rather than silently choosing one", () => {
  assert.throws(() => parseFiscalQr(VALID + "&s=1000.00"), FiscalQrError);
});

test("rejects impossible dates", () => {
  assert.throws(() => parseFiscalQr(VALID.replace("20261015", "20260230")), FiscalQrError);
});

test("rejects invalid money syntax", () => {
  for (const sum of ["0", "1.234", "1,23", "-10.00", "not-money"]) {
    assert.throws(() => parseFiscalQr(VALID.replace("125.50", sum)), FiscalQrError);
  }
});

test("rejects unsupported fiscal operation signs", () => {
  assert.throws(() => parseFiscalQr(VALID.replace("&n=1", "&n=7")), FiscalQrError);
});

test("rejects an arbitrary URL and HTML rather than treating them as receipts", () => {
  for (const value of ["https://example.org/?a=b", "<script>alert(1)</script>", ""]) {
    assert.throws(() => parseFiscalQr(value), FiscalQrError);
  }
});

test("preserves the exact local calendar date without timezone conversion", () => {
  assert.equal(
    parseFiscalQr(VALID.replace("20261015T1840", "20260101T0000")).occurredOn,
    "2026-01-01",
  );
});
