import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPECTED_SOURCE_HEADERS } from '../../dist/integration/google/sourceSchema.js';
import {
  FullSourceSnapshotError,
  observeCanonicalFullSourceSnapshot,
} from '../../dist/integration/google/fullSourceSnapshot.js';

function digestSpy() {
  const calls = [];
  return {
    calls,
    digestCanonicalSnapshot(value) {
      calls.push(value);
      return `digest-${value.length}`;
    },
  };
}

function blankRow() {
  return Array.from({ length: EXPECTED_SOURCE_HEADERS.length }, () => null);
}

function input(rows, headers = EXPECTED_SOURCE_HEADERS) {
  return { headers, rows };
}

test('canonical snapshot digest is stable and digest function runs exactly once', () => {
  const digest = digestSpy();
  const rows = [
    [
      { numberValue: 45000 },
      { stringValue: 'Расход' },
      { stringValue: 'Synthetic Account' },
      { stringValue: 'Synthetic Category' },
      { stringValue: 'Synthetic' },
      { numberValue: 1.5 },
      null,
      null,
      null,
      null,
      { stringValue: 'A\r\nB' },
    ],
  ];

  const first = observeCanonicalFullSourceSnapshot(input(rows), digest);
  const canonical = digest.calls[0];
  assert.equal(first.rowCount, 1);
  assert.equal(digest.calls.length, 1);
  assert.equal(typeof canonical, 'string');
  assert.ok(canonical.includes('PRIHRASH_SOURCE_SNAPSHOT_V1'));

  const secondDigest = digestSpy();
  const second = observeCanonicalFullSourceSnapshot(input(rows), secondDigest);
  assert.equal(second.snapshotDigest, first.snapshotDigest);
  assert.equal(secondDigest.calls[0], canonical);
});

test('authoritative row order affects canonical digest input', () => {
  const rowA = blankRow();
  rowA[4] = { stringValue: 'A' };
  const rowB = blankRow();
  rowB[4] = { stringValue: 'B' };

  const left = digestSpy();
  const right = digestSpy();
  observeCanonicalFullSourceSnapshot(input([rowA, rowB]), left);
  observeCanonicalFullSourceSnapshot(input([rowB, rowA]), right);
  assert.notEqual(left.calls[0], right.calls[0]);
});

test('typed cell semantics distinguish STRING 1 from NUMBER 1', () => {
  const stringRow = blankRow();
  stringRow[5] = { stringValue: '1' };
  const numberRow = blankRow();
  numberRow[5] = { numberValue: 1 };

  const stringDigest = digestSpy();
  const numberDigest = digestSpy();
  observeCanonicalFullSourceSnapshot(input([stringRow]), stringDigest);
  observeCanonicalFullSourceSnapshot(input([numberRow]), numberDigest);
  assert.notEqual(stringDigest.calls[0], numberDigest.calls[0]);
});

test('safe source text normalization makes CRLF and NFC-equivalent text stable', () => {
  const composed = blankRow();
  composed[4] = { stringValue: 'Café\r\nX' };
  const decomposed = blankRow();
  decomposed[4] = { stringValue: 'Cafe\u0301\nX' };

  const left = digestSpy();
  const right = digestSpy();
  observeCanonicalFullSourceSnapshot(input([composed]), left);
  observeCanonicalFullSourceSnapshot(input([decomposed]), right);
  assert.equal(left.calls[0], right.calls[0]);
});

test('schema mismatch fails closed before digest call', () => {
  const digest = digestSpy();
  const headers = [...EXPECTED_SOURCE_HEADERS];
  headers[0] = 'Дата';
  assert.throws(
    () => observeCanonicalFullSourceSnapshot(input([], headers), digest),
    (error) => error instanceof FullSourceSnapshotError && error.code === 'SOURCE_SCHEMA_MISMATCH',
  );
  assert.equal(digest.calls.length, 0);
});

test('row width mismatch fails closed before digest call', () => {
  const digest = digestSpy();
  assert.throws(
    () => observeCanonicalFullSourceSnapshot(input([[null]]), digest),
    (error) => error instanceof FullSourceSnapshotError && error.code === 'SOURCE_ROW_WIDTH_MISMATCH',
  );
  assert.equal(digest.calls.length, 0);
});

test('formula/bool/error source cells remain fail-closed through existing codec', () => {
  for (const invalid of [
    { formulaValue: '=1+1' },
    { boolValue: true },
    { errorValue: { message: 'x' } },
  ]) {
    const row = blankRow();
    row[0] = invalid;
    const digest = digestSpy();
    assert.throws(() => observeCanonicalFullSourceSnapshot(input([row]), digest));
    assert.equal(digest.calls.length, 0);
  }
});

test('invalid digest result fails closed without exposing canonical input', () => {
  for (const value of ['', ' digest', 'digest ']) {
    assert.throws(
      () => observeCanonicalFullSourceSnapshot(input([]), { digestCanonicalSnapshot: () => value }),
      (error) => error instanceof FullSourceSnapshotError && error.code === 'INVALID_SNAPSHOT_DIGEST',
    );
  }
});
