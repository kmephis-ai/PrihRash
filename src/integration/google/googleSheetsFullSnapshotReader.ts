import {
  observeCanonicalFullSourceSnapshot,
  type FullSourceSnapshotDigest,
} from './fullSourceSnapshot.js';
import {
  EXPECTED_SOURCE_HEADERS,
  SOURCE_SHEET_NAME,
} from './sourceSchema.js';
import {
  encodeGoogleExtendedValue,
  type GoogleExtendedValueInput,
} from './sourceValueCodec.js';

const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const EXPECTED_SPREADSHEET_TITLE = 'ПрихРасхOnline';
const EXPECTED_SOURCE_LOCALE = 'ru_RU';
const EXPECTED_SOURCE_TIMEZONE = 'Europe/Moscow';

export interface GoogleSheetsHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface GoogleSheetsFetch {
  (
    input: string,
    init: Readonly<{
      method: 'GET';
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<GoogleSheetsHttpResponse>;
}

export interface GoogleSheetsAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleSheetsFullSnapshotReaderConfig {
  readonly spreadsheetId: string;
  readonly fetch: GoogleSheetsFetch;
  readonly accessTokenProvider: GoogleSheetsAccessTokenProvider;
  readonly digest: FullSourceSnapshotDigest;
}

export interface GoogleSheetsSnapshotRow {
  readonly rowHint: number;
  readonly values: readonly (Readonly<GoogleExtendedValueInput> | null)[];
}

export interface GoogleSheetsImmutableSnapshot {
  readonly spreadsheetId: string;
  readonly spreadsheetTitle: string;
  readonly sheetName: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly rows: readonly Readonly<GoogleSheetsSnapshotRow>[];
}

export interface GoogleSheetsFullSnapshotLease {
  readonly snapshotDigest: string;
  readonly snapshot: Readonly<GoogleSheetsImmutableSnapshot>;
}

export type GoogleSheetsFullSnapshotReaderErrorCode =
  | 'INVALID_SPREADSHEET_ID'
  | 'INVALID_ACCESS_TOKEN'
  | 'GOOGLE_SHEETS_HTTP_ERROR'
  | 'GOOGLE_SHEETS_RESPONSE_INVALID'
  | 'SOURCE_METADATA_MISMATCH'
  | 'SOURCE_SHEET_MISSING';

export class GoogleSheetsFullSnapshotReaderError extends Error {
  readonly code: GoogleSheetsFullSnapshotReaderErrorCode;
  readonly httpStatus: number | null;

  constructor(code: GoogleSheetsFullSnapshotReaderErrorCode, httpStatus: number | null = null) {
    super(code);
    this.name = 'GoogleSheetsFullSnapshotReaderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function parseExtendedValue(value: unknown): Readonly<GoogleExtendedValueInput> | null {
  if (value === undefined || value === null) return null;
  const object = asObject(value);
  if (object === null) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }
  return Object.freeze({
    ...(Object.hasOwn(object, 'numberValue') ? { numberValue: object.numberValue } : {}),
    ...(Object.hasOwn(object, 'stringValue') ? { stringValue: object.stringValue } : {}),
    ...(Object.hasOwn(object, 'formulaValue') ? { formulaValue: object.formulaValue } : {}),
    ...(Object.hasOwn(object, 'boolValue') ? { boolValue: object.boolValue } : {}),
    ...(Object.hasOwn(object, 'errorValue') ? { errorValue: object.errorValue } : {}),
  });
}

function parseRowValues(row: unknown): readonly (Readonly<GoogleExtendedValueInput> | null)[] {
  const rowObject = asObject(row);
  if (rowObject === null) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }
  const rawValues = rowObject.values === undefined ? [] : asArray(rowObject.values);
  if (rawValues === null || rawValues.length > EXPECTED_SOURCE_HEADERS.length) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }

  const values: (Readonly<GoogleExtendedValueInput> | null)[] = [];
  for (let index = 0; index < EXPECTED_SOURCE_HEADERS.length; index += 1) {
    const cell = rawValues[index];
    if (cell === undefined) {
      values.push(null);
      continue;
    }
    const cellObject = asObject(cell);
    if (cellObject === null) {
      throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
    }
    values.push(parseExtendedValue(cellObject.userEnteredValue));
  }
  return Object.freeze(values);
}

function parseHeader(values: readonly (Readonly<GoogleExtendedValueInput> | null)[]): string[] {
  return values.map((value) => {
    const encoded = encodeGoogleExtendedValue(value);
    if (encoded === null || encoded.kind !== 'STRING') return '';
    return encoded.value;
  });
}

function buildReadUrl(spreadsheetId: string): string {
  const range = `'${SOURCE_SHEET_NAME.replaceAll("'", "''")}'!A:K`;
  const params = new URLSearchParams({
    ranges: range,
    includeGridData: 'true',
    fields: 'properties(title,locale,timeZone),sheets(properties(title),data(rowData(values(userEnteredValue))))',
  });
  return `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
}

function parseSnapshotResponse(
  payload: unknown,
  spreadsheetId: string,
  digest: FullSourceSnapshotDigest,
): Readonly<GoogleSheetsFullSnapshotLease> {
  const root = asObject(payload);
  const properties = root === null ? null : asObject(root.properties);
  const sheets = root === null ? null : asArray(root.sheets);
  if (root === null || properties === null || sheets === null) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }

  const title = asString(properties.title);
  const locale = asString(properties.locale);
  const timeZone = asString(properties.timeZone);
  if (title === null || locale === null || timeZone === null) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }
  if (
    title !== EXPECTED_SPREADSHEET_TITLE
    || locale !== EXPECTED_SOURCE_LOCALE
    || timeZone !== EXPECTED_SOURCE_TIMEZONE
  ) {
    throw new GoogleSheetsFullSnapshotReaderError('SOURCE_METADATA_MISMATCH');
  }

  const sourceSheet = sheets.find((sheet) => {
    const sheetObject = asObject(sheet);
    const sheetProperties = sheetObject === null ? null : asObject(sheetObject.properties);
    return sheetProperties !== null && asString(sheetProperties.title) === SOURCE_SHEET_NAME;
  });
  const sourceSheetObject = asObject(sourceSheet);
  if (sourceSheetObject === null) {
    throw new GoogleSheetsFullSnapshotReaderError('SOURCE_SHEET_MISSING');
  }

  const data = asArray(sourceSheetObject.data);
  const firstGrid = data === null ? null : asObject(data[0]);
  const rowData = firstGrid === null ? null : asArray(firstGrid.rowData);
  if (rowData === null || rowData.length === 0) {
    throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_RESPONSE_INVALID');
  }

  const headerValues = parseRowValues(rowData[0]);
  const headers = parseHeader(headerValues);
  const providerRows = rowData.slice(1).map((row, index): Readonly<GoogleSheetsSnapshotRow> => Object.freeze({
    rowHint: index + 2,
    values: parseRowValues(row),
  }));

  const observed = observeCanonicalFullSourceSnapshot({
    headers,
    rows: providerRows.map((row) => row.values),
  }, digest);

  const snapshot = Object.freeze({
    spreadsheetId,
    spreadsheetTitle: title,
    sheetName: SOURCE_SHEET_NAME,
    locale,
    timeZone,
    rows: Object.freeze(providerRows),
  });

  return Object.freeze({
    snapshotDigest: observed.snapshotDigest,
    snapshot,
  });
}

export class GoogleSheetsFullSnapshotReader {
  private readonly spreadsheetId: string;
  private readonly fetch: GoogleSheetsFetch;
  private readonly accessTokenProvider: GoogleSheetsAccessTokenProvider;
  private readonly digest: FullSourceSnapshotDigest;

  constructor(config: Readonly<GoogleSheetsFullSnapshotReaderConfig>) {
    if (config.spreadsheetId.trim().length === 0) {
      throw new GoogleSheetsFullSnapshotReaderError('INVALID_SPREADSHEET_ID');
    }
    this.spreadsheetId = config.spreadsheetId;
    this.fetch = config.fetch;
    this.accessTokenProvider = config.accessTokenProvider;
    this.digest = config.digest;
  }

  async readFullSnapshotObservation(): Promise<Readonly<GoogleSheetsFullSnapshotLease>> {
    const accessToken = await this.accessTokenProvider.getAccessToken();
    if (accessToken.trim().length === 0) {
      throw new GoogleSheetsFullSnapshotReaderError('INVALID_ACCESS_TOKEN');
    }

    const response = await this.fetch(buildReadUrl(this.spreadsheetId), {
      method: 'GET',
      headers: Object.freeze({
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      }),
    });
    if (!response.ok) {
      throw new GoogleSheetsFullSnapshotReaderError('GOOGLE_SHEETS_HTTP_ERROR', response.status);
    }

    return parseSnapshotResponse(await response.json(), this.spreadsheetId, this.digest);
  }
}
