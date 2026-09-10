import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPECTED_SOURCE_HEADERS, SOURCE_SHEET_NAME } from '../../dist/integration/google/sourceSchema.js';
import {
  GoogleSheetsFullSnapshotReader,
  GoogleSheetsFullSnapshotReaderError,
} from '../../dist/integration/google/googleSheetsFullSnapshotReader.js';

function syntheticRow(overrides = {}) {
  const values = Array.from({ length: EXPECTED_SOURCE_HEADERS.length }, () => ({}));
  values[0] = { userEnteredValue: { numberValue: 45000 } };
  values[1] = { userEnteredValue: { stringValue: 'Расход' } };
  values[2] = { userEnteredValue: { stringValue: 'Карта Visa' } };
  values[3] = { userEnteredValue: { stringValue: 'Synthetic Category' } };
  values[4] = { userEnteredValue: { stringValue: 'Synthetic Description' } };
  values[5] = { userEnteredValue: { numberValue: 12.34 } };
  values[10] = { userEnteredValue: { stringValue: 'Synthetic Note' } };
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return { values };
}

function providerPayload({
  title = 'ПрихРасхOnline',
  locale = 'ru_RU',
  timeZone = 'Europe/Moscow',
  sheetTitle = SOURCE_SHEET_NAME,
  rows = [syntheticRow()],
  header = { values: EXPECTED_SOURCE_HEADERS.map((value) => ({ userEnteredValue: { stringValue: value } })) },
} = {}) {
  return {
    properties: { title, locale, timeZone },
    sheets: [
      {
        properties: { title: sheetTitle },
        data: [{ rowData: [header, ...rows] }],
      },
    ],
  };
}

function digestSpy() {
  const calls = [];
  return {
    calls,
    digestCanonicalSnapshot(value) {
      calls.push(value);
      return `sha256-synthetic-${value.length}`;
    },
  };
}

function makeReader({ payload = providerPayload(), ok = true, status = 200, token = 'token-1', spreadsheetId = 'spreadsheet-1' } = {}) {
  const observed = { fetchCalls: [], tokenCalls: 0 };
  const digest = digestSpy();
  const reader = new GoogleSheetsFullSnapshotReader({
    spreadsheetId,
    digest,
    accessTokenProvider: {
      async getAccessToken() {
        observed.tokenCalls += 1;
        return token;
      },
    },
    async fetch(input, init) {
      observed.fetchCalls.push({ input, init });
      return {
        ok,
        status,
        async json() {
          return payload;
        },
      };
    },
  });
  return { reader, observed, digest };
}

test('reads exact A:K userEnteredValue snapshot once and returns immutable lease', async () => {
  const { reader, observed, digest } = makeReader();

  const lease = await reader.readFullSnapshotObservation();

  assert.equal(observed.tokenCalls, 1);
  assert.equal(observed.fetchCalls.length, 1);
  const request = observed.fetchCalls[0];
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.headers.Authorization, 'Bearer token-1');
  assert.equal(request.init.headers.Accept, 'application/json');

  const url = new URL(request.input);
  assert.equal(url.origin, 'https://sheets.googleapis.com');
  assert.equal(url.pathname, '/v4/spreadsheets/spreadsheet-1');
  assert.deepEqual(url.searchParams.getAll('ranges'), [`'${SOURCE_SHEET_NAME}'!A:K`]);
  assert.equal(url.searchParams.get('includeGridData'), 'true');
  assert.match(url.searchParams.get('fields'), /userEnteredValue/);
  assert.doesNotMatch(url.searchParams.get('fields'), /formattedValue/);

  assert.equal(digest.calls.length, 1);
  assert.equal(lease.snapshotDigest.startsWith('sha256-synthetic-'), true);
  assert.equal(lease.snapshot.spreadsheetId, 'spreadsheet-1');
  assert.equal(lease.snapshot.spreadsheetTitle, 'ПрихРасхOnline');
  assert.equal(lease.snapshot.sheetName, SOURCE_SHEET_NAME);
  assert.equal(lease.snapshot.locale, 'ru_RU');
  assert.equal(lease.snapshot.timeZone, 'Europe/Moscow');
  assert.equal(lease.snapshot.rows.length, 1);
  assert.equal(lease.snapshot.rows[0].rowHint, 2);
  assert.equal(lease.snapshot.rows[0].values.length, 11);
  assert.deepEqual(lease.snapshot.rows[0].values[0], { numberValue: 45000 });
  assert.deepEqual(lease.snapshot.rows[0].values[10], { stringValue: 'Synthetic Note' });
  assert.equal(Object.isFrozen(lease), true);
  assert.equal(Object.isFrozen(lease.snapshot), true);
  assert.equal(Object.isFrozen(lease.snapshot.rows), true);
  assert.equal(Object.isFrozen(lease.snapshot.rows[0]), true);
  assert.equal(Object.isFrozen(lease.snapshot.rows[0].values), true);
});

test('pads omitted trailing Google cells to exact A:K blanks', async () => {
  const shortRow = {
    values: [
      { userEnteredValue: { numberValue: 45000 } },
      { userEnteredValue: { stringValue: 'Доход' } },
      {},
      {},
      {},
      {},
      { userEnteredValue: { stringValue: 'Карта Visa' } },
      { userEnteredValue: { stringValue: 'Synthetic Income' } },
      { userEnteredValue: { numberValue: 100 } },
    ],
  };
  const { reader } = makeReader({ payload: providerPayload({ rows: [shortRow] }) });

  const lease = await reader.readFullSnapshotObservation();

  assert.equal(lease.snapshot.rows[0].values.length, 11);
  assert.equal(lease.snapshot.rows[0].values[9], null);
  assert.equal(lease.snapshot.rows[0].values[10], null);
});

test('metadata mismatch fails closed before digesting payload', async () => {
  for (const mismatch of [
    { title: 'Wrong Spreadsheet' },
    { locale: 'en_US' },
    { timeZone: 'UTC' },
  ]) {
    const { reader, digest } = makeReader({ payload: providerPayload(mismatch) });
    await assert.rejects(
      () => reader.readFullSnapshotObservation(),
      (error) => error instanceof GoogleSheetsFullSnapshotReaderError && error.code === 'SOURCE_METADATA_MISMATCH',
    );
    assert.equal(digest.calls.length, 0);
  }
});

test('missing source sheet fails closed', async () => {
  const { reader } = makeReader({ payload: providerPayload({ sheetTitle: 'Other Sheet' }) });
  await assert.rejects(
    () => reader.readFullSnapshotObservation(),
    (error) => error instanceof GoogleSheetsFullSnapshotReaderError && error.code === 'SOURCE_SHEET_MISSING',
  );
});

test('header schema drift fails closed through canonical source contract', async () => {
  const headers = [...EXPECTED_SOURCE_HEADERS];
  headers[0] = ' Дата';
  const header = { values: headers.map((value) => ({ userEnteredValue: { stringValue: value } })) };
  const { reader, digest } = makeReader({ payload: providerPayload({ header }) });

  await assert.rejects(
    () => reader.readFullSnapshotObservation(),
    (error) => error?.code === 'SOURCE_SCHEMA_MISMATCH',
  );
  assert.equal(digest.calls.length, 0);
});

test('provider formula/bool/error cells remain fail-closed', async () => {
  for (const invalid of [
    { formulaValue: '=1+1' },
    { boolValue: true },
    { errorValue: { message: 'x' } },
  ]) {
    const row = syntheticRow({ 4: { userEnteredValue: invalid } });
    const { reader, digest } = makeReader({ payload: providerPayload({ rows: [row] }) });
    await assert.rejects(() => reader.readFullSnapshotObservation());
    assert.equal(digest.calls.length, 0);
  }
});

test('malformed provider shape and rows wider than A:K fail closed', async () => {
  for (const payload of [
    null,
    {},
    { properties: {}, sheets: [] },
    providerPayload({ rows: [{ values: Array.from({ length: 12 }, () => ({})) }] }),
    providerPayload({ rows: [null] }),
  ]) {
    const { reader } = makeReader({ payload });
    await assert.rejects(
      () => reader.readFullSnapshotObservation(),
      (error) => error instanceof GoogleSheetsFullSnapshotReaderError && error.code === 'GOOGLE_SHEETS_RESPONSE_INVALID',
    );
  }
});

test('HTTP errors preserve status without reading or digesting response body', async () => {
  let jsonCalls = 0;
  const digest = digestSpy();
  const reader = new GoogleSheetsFullSnapshotReader({
    spreadsheetId: 'spreadsheet-1',
    digest,
    accessTokenProvider: { async getAccessToken() { return 'token-1'; } },
    async fetch() {
      return {
        ok: false,
        status: 503,
        async json() {
          jsonCalls += 1;
          return providerPayload();
        },
      };
    },
  });

  await assert.rejects(
    () => reader.readFullSnapshotObservation(),
    (error) => error instanceof GoogleSheetsFullSnapshotReaderError
      && error.code === 'GOOGLE_SHEETS_HTTP_ERROR'
      && error.httpStatus === 503,
  );
  assert.equal(jsonCalls, 0);
  assert.equal(digest.calls.length, 0);
});

test('invalid credentials/config fail before provider read', async () => {
  assert.throws(
    () => new GoogleSheetsFullSnapshotReader({
      spreadsheetId: '   ',
      digest: digestSpy(),
      accessTokenProvider: { async getAccessToken() { return 'x'; } },
      async fetch() { throw new Error('must not run'); },
    }),
    (error) => error instanceof GoogleSheetsFullSnapshotReaderError && error.code === 'INVALID_SPREADSHEET_ID',
  );

  let fetchCalls = 0;
  const { reader } = makeReader({ token: '   ' });
  reader.fetch = undefined;
  const tokenReader = new GoogleSheetsFullSnapshotReader({
    spreadsheetId: 'spreadsheet-1',
    digest: digestSpy(),
    accessTokenProvider: { async getAccessToken() { return '   '; } },
    async fetch() {
      fetchCalls += 1;
      throw new Error('must not run');
    },
  });
  await assert.rejects(
    () => tokenReader.readFullSnapshotObservation(),
    (error) => error instanceof GoogleSheetsFullSnapshotReaderError && error.code === 'INVALID_ACCESS_TOKEN',
  );
  assert.equal(fetchCalls, 0);
});
