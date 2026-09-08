import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { readScheduledSyncAdmissionEvidence } from '../migration/scheduledSyncAdmissionEvidence.js';

export const READER_FILTER_OPTIONS_API_VERSION = 1 as const;

export interface ReaderAccountFilterOption {
  readonly id: string;
  readonly label: string;
}

export interface ReaderCategoryFilterOption extends ReaderAccountFilterOption {
  readonly kind: 'EXPENSE' | 'INCOME';
}

export interface ReaderFilterOptionsApiResponse {
  readonly apiVersion: typeof READER_FILTER_OPTIONS_API_VERSION;
  readonly accounts: readonly Readonly<ReaderAccountFilterOption>[];
  readonly categories: readonly Readonly<ReaderCategoryFilterOption>[];
}

export type ReaderFilterOptionsErrorCode =
  | 'VERIFIED_SHADOW_UNAVAILABLE'
  | 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'
  | 'MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE'
  | 'AMBIGUOUS_ACCOUNT_FILTER_OPTION_EVIDENCE'
  | 'AMBIGUOUS_CATEGORY_FILTER_OPTION_EVIDENCE'
  | 'FILTER_OPTIONS_READ_FAILED';

export class ReaderFilterOptionsError extends Error {
  readonly code: ReaderFilterOptionsErrorCode;

  constructor(code: ReaderFilterOptionsErrorCode) {
    super(code);
    this.name = 'ReaderFilterOptionsError';
    this.code = code;
  }
}

interface AccountFilterOptionRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly currency?: unknown;
}

interface CategoryFilterOptionRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly kind?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CATEGORY_KINDS = new Set(['EXPENSE', 'INCOME']);

function fail(code: ReaderFilterOptionsErrorCode): never {
  throw new ReaderFilterOptionsError(code);
}

function uuid(value: unknown, code: ReaderFilterOptionsErrorCode): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return fail(code);
  return value.toLowerCase();
}

function label(value: unknown, code: ReaderFilterOptionsErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return fail(code);
  return value;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseAccount(row: Readonly<AccountFilterOptionRow>): Readonly<ReaderAccountFilterOption> {
  if (row.currency !== 'RUB') return fail('MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE');
  return Object.freeze({
    id: uuid(row.id, 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'),
    label: label(row.name, 'MALFORMED_ACCOUNT_FILTER_OPTION_EVIDENCE'),
  });
}

function parseCategory(row: Readonly<CategoryFilterOptionRow>): Readonly<ReaderCategoryFilterOption> {
  if (typeof row.kind !== 'string' || !CATEGORY_KINDS.has(row.kind)) {
    return fail('MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE');
  }
  return Object.freeze({
    id: uuid(row.id, 'MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE'),
    label: label(row.name, 'MALFORMED_CATEGORY_FILTER_OPTION_EVIDENCE'),
    kind: row.kind as 'EXPENSE' | 'INCOME',
  });
}

function rejectAmbiguousAccounts(accounts: readonly Readonly<ReaderAccountFilterOption>[]): void {
  const labels = new Set<string>();
  for (const option of accounts) {
    if (labels.has(option.label)) return fail('AMBIGUOUS_ACCOUNT_FILTER_OPTION_EVIDENCE');
    labels.add(option.label);
  }
}

function rejectAmbiguousCategories(categories: readonly Readonly<ReaderCategoryFilterOption>[]): void {
  const keys = new Set<string>();
  for (const option of categories) {
    const key = `${option.kind}\u0000${option.label}`;
    if (keys.has(key)) return fail('AMBIGUOUS_CATEGORY_FILTER_OPTION_EVIDENCE');
    keys.add(key);
  }
}

async function requireVerifiedShadow(adapter: YdbAdapter): Promise<void> {
  try {
    const evidence = await readScheduledSyncAdmissionEvidence(adapter);
    if (evidence.committedBaselineRun === null) {
      throw new ReaderFilterOptionsError('VERIFIED_SHADOW_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof ReaderFilterOptionsError) throw error;
    throw new ReaderFilterOptionsError('VERIFIED_SHADOW_UNAVAILABLE');
  }
}

export async function executeReaderFilterOptionsApiRequest(
  adapter: YdbAdapter,
): Promise<Readonly<ReaderFilterOptionsApiResponse>> {
  await requireVerifiedShadow(adapter);

  let accountRows: readonly Readonly<AccountFilterOptionRow>[];
  let categoryRows: readonly Readonly<CategoryFilterOptionRow>[];
  try {
    const accounts = await adapter.read<AccountFilterOptionRow>(readStatement(
      'SELECT id, name, currency FROM accounts ORDER BY name ASC, id ASC',
    ));
    const categories = await adapter.read<CategoryFilterOptionRow>(readStatement(
      'SELECT id, name, kind FROM categories ORDER BY kind ASC, name ASC, id ASC',
    ));
    accountRows = accounts.rows;
    categoryRows = categories.rows;
  } catch {
    throw new ReaderFilterOptionsError('FILTER_OPTIONS_READ_FAILED');
  }

  const accounts = accountRows.map(parseAccount)
    .sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
  const categories = categoryRows.map(parseCategory)
    .sort((left, right) => compareText(left.kind, right.kind)
      || compareText(left.label, right.label)
      || compareText(left.id, right.id));

  rejectAmbiguousAccounts(accounts);
  rejectAmbiguousCategories(categories);

  return Object.freeze({
    apiVersion: READER_FILTER_OPTIONS_API_VERSION,
    accounts: Object.freeze(accounts),
    categories: Object.freeze(categories),
  });
}
