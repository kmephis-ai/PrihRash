import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceValueCodecError } from '../../dist/integration/google/sourceValueCodec.js';
import {
  GoogleSnapshotProjectionError,
  projectGoogleSnapshotForIncrementalMigration,
} from '../../dist/migration/googleSnapshotProjection.js';
import { serializeRawPayload } from '../../dist/migration/rawPayloadProvenance.js';

function row(rowHint = 2, overrides = {}) {
  const values = [
    { numberValue: 45000 },
    { stringValue: 'Расход' },
    { stringValue: 'Карта Visa' },
    { stringValue: 'Synthetic Category' },
    { stringValue: 'Synthetic Description' },
    { numberValue: 12.34 },
    null,
    null,
    null,
    { stringValue: 'Да' },
    { stringValue: 'Synthetic Note' },
  ];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return Object.freeze({ rowHint, values: Object.freeze(values) });
}

function snapshot(rows = [row()]) {
  return Object.freeze({
    spreadsheetId: 'synthetic-spreadsheet',
    spreadsheetTitle: 'ПрихРасхOnline',
    sheetName: 'Ответы на форму (11)',
    locale: 'ru_RU',
    timeZone: 'Europe/Moscow',
    rows: Object.freeze(rows),
  });
}

function digestSpy() {
  const canonicalRows = [];
  return {
    canonicalRows,
    digestCanonicalRow(canonicalRow) {
      canonicalRows.push(canonicalRow);
      return `row-digest-${canonicalRows.length}`;
    },
  };
}

test('maps exact A:K positions to current RawPayloadV3 adapter keys and sequence evidence', () => {
  const digest = digestSpy();
  const projection = projectGoogleSnapshotForIncrementalMigration(snapshot(), digest);

  assert.equal(projection.rows.length, 1);
  assert.deepEqual(projection.rows[0], {
    rowHint: 2,
    digest: 'row-digest-1',
    rawPayload: {
      adapter_schema_version: 3,
      date: { kind: 'NUMBER', value: '45000' },
      operation_type: { kind: 'STRING', value: 'Расход' },
      expense_account: { kind: 'STRING', value: 'Карта Visa' },
      expense_category: { kind: 'STRING', value: 'Synthetic Category' },
      description: { kind: 'STRING', value: 'Synthetic Description' },
      expense_amount: { kind: 'NUMBER', value: '12.34' },
      income_account: null,
      income_category: null,
      income_amount: null,
      vika_flag: { kind: 'STRING', value: 'Да' },
      note: { kind: 'STRING', value: 'Synthetic Note' },
    },
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.rows), true);
  assert.equal(Object.isFrozen(projection.rows[0]), true);
  assert.equal(Object.isFrozen(projection.rows[0].rawPayload), true);

  assert.equal(
    digest.canonicalRows[0],
    serializeRawPayload({ ...projection.rows[0].rawPayload, adapter_schema_version: 2 }),
  );
});


test('v3 provenance keeps v2-compatible lineage digest framing for unchanged A-K cells', () => {
  const digest = digestSpy();
  const projection = projectGoogleSnapshotForIncrementalMigration(snapshot(), digest);
  const legacyEquivalent = serializeRawPayload({
    ...projection.rows[0].rawPayload,
    adapter_schema_version: 2,
  });

  assert.equal(projection.rows[0].rawPayload.adapter_schema_version, 3);
  assert.equal(digest.canonicalRows[0], legacyEquivalent);
});

test('canonical row digest input is deterministic for semantically identical provider objects', () => {
  const firstDigest = digestSpy();
  const secondDigest = digestSpy();
  const first = row(2, {
    4: { stringValue: 'Cafe\r\nTrip' },
    5: { numberValue: 1e-7 },
  });
  const second = row(2, {
    4: Object.assign({}, { stringValue: 'Cafe\nTrip' }),
    5: Object.assign({}, { numberValue: 0.0000001 }),
  });

  projectGoogleSnapshotForIncrementalMigration(snapshot([first]), firstDigest);
  projectGoogleSnapshotForIncrementalMigration(snapshot([second]), secondDigest);

  assert.equal(firstDigest.canonicalRows[0], secondDigest.canonicalRows[0]);
});

test('STRING, NUMBER and null remain distinct in canonical row evidence', () => {
  const digest = digestSpy();
  const projection = projectGoogleSnapshotForIncrementalMigration(snapshot([
    row(2, { 10: { stringValue: '1' } }),
    row(3, { 10: { numberValue: 1 } }),
    row(4, { 10: null }),
  ]), digest);

  assert.deepEqual(projection.rows.map((item) => item.rawPayload.note), [
    { kind: 'STRING', value: '1' },
    { kind: 'NUMBER', value: '1' },
    null,
  ]);
  assert.equal(new Set(digest.canonicalRows).size, 3);
  assert.deepEqual(projection.rows.map(({ rowHint, digest: rowDigest }) => ({ rowHint, digest: rowDigest })), [
    { rowHint: 2, digest: 'row-digest-1' },
    { rowHint: 3, digest: 'row-digest-2' },
    { rowHint: 4, digest: 'row-digest-3' },
  ]);
});

test('preserves provider row order and exact row hints', () => {
  const projection = projectGoogleSnapshotForIncrementalMigration(
    snapshot([row(9), row(12), row(20)]),
    digestSpy(),
  );

  assert.deepEqual(projection.rows.map((item) => item.rowHint), [9, 12, 20]);
});

test('invalid or duplicate row hints fail closed', () => {
  for (const invalidRowHint of [0, 1, -2, 2.5, Number.NaN]) {
    assert.throws(
      () => projectGoogleSnapshotForIncrementalMigration(snapshot([row(invalidRowHint)]), digestSpy()),
      (error) => error instanceof GoogleSnapshotProjectionError && error.code === 'INVALID_ROW_HINT',
    );
  }

  assert.throws(
    () => projectGoogleSnapshotForIncrementalMigration(snapshot([row(2), row(2)]), digestSpy()),
    (error) => error instanceof GoogleSnapshotProjectionError && error.code === 'DUPLICATE_ROW_HINT',
  );
});

test('wrong row width fails closed before digest', () => {
  const digest = digestSpy();
  const shortRow = Object.freeze({ rowHint: 2, values: Object.freeze(row().values.slice(0, 10)) });

  assert.throws(
    () => projectGoogleSnapshotForIncrementalMigration(snapshot([shortRow]), digest),
    (error) => error instanceof GoogleSnapshotProjectionError && error.code === 'SOURCE_ROW_WIDTH_MISMATCH',
  );
  assert.equal(digest.canonicalRows.length, 0);
});

test('formula, bool and malformed extended values fail closed through existing source codec', () => {
  for (const invalidCell of [
    { formulaValue: '=1+1' },
    { boolValue: true },
    { stringValue: 'x', numberValue: 1 },
  ]) {
    assert.throws(
      () => projectGoogleSnapshotForIncrementalMigration(snapshot([row(2, { 4: invalidCell })]), digestSpy()),
      (error) => error instanceof SourceValueCodecError,
    );
  }
});

test('empty or non-string row digest fails closed', () => {
  for (const invalidDigest of ['', '   ', null]) {
    assert.throws(
      () => projectGoogleSnapshotForIncrementalMigration(snapshot(), {
        digestCanonicalRow() { return invalidDigest; },
      }),
      (error) => error instanceof GoogleSnapshotProjectionError && error.code === 'INVALID_ROW_DIGEST',
    );
  }
});
