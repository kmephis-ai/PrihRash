import { readStatement, YdbAdapter } from '../integration/ydb/adapter.js';
import { normalizeSourceLabel, type CategoryKind } from './bootstrap.js';
import type { AccountReferenceMapping, CategoryReferenceMapping } from './resolver.js';

interface AccountReferenceRow {
  readonly id?: unknown;
  readonly normalized_source_label?: unknown;
  readonly currency?: unknown;
}

interface CategoryReferenceRow {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly normalized_source_label?: unknown;
}

export interface YdbReferenceMappingEvidence {
  readonly accounts: readonly Readonly<AccountReferenceMapping>[];
  readonly categories: readonly Readonly<CategoryReferenceMapping>[];
}

export type YdbReferenceEvidenceReaderErrorCode =
  | 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'
  | 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE';

export class YdbReferenceEvidenceReaderError extends Error {
  readonly code: YdbReferenceEvidenceReaderErrorCode;

  constructor(code: YdbReferenceEvidenceReaderErrorCode) {
    super(code);
    this.name = 'YdbReferenceEvidenceReaderError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function uuid(value: unknown, code: YdbReferenceEvidenceReaderErrorCode): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new YdbReferenceEvidenceReaderError(code);
  }
  return value.toLowerCase();
}

function normalizedLabel(value: unknown, code: YdbReferenceEvidenceReaderErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || normalizeSourceLabel(value) !== value) {
    throw new YdbReferenceEvidenceReaderError(code);
  }
  return value;
}

function accountMapping(row: Readonly<AccountReferenceRow>): Readonly<AccountReferenceMapping> {
  if (row.currency !== 'RUB') {
    throw new YdbReferenceEvidenceReaderError('MALFORMED_ACCOUNT_REFERENCE_EVIDENCE');
  }
  return Object.freeze({
    sourceLabel: normalizedLabel(row.normalized_source_label, 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'),
    currency: 'RUB' as const,
    accountId: uuid(row.id, 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'),
  });
}

function categoryMapping(row: Readonly<CategoryReferenceRow>): Readonly<CategoryReferenceMapping> {
  if (row.kind !== 'EXPENSE' && row.kind !== 'INCOME') {
    throw new YdbReferenceEvidenceReaderError('MALFORMED_CATEGORY_REFERENCE_EVIDENCE');
  }
  return Object.freeze({
    kind: row.kind as CategoryKind,
    sourceLabel: normalizedLabel(row.normalized_source_label, 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'),
    categoryId: uuid(row.id, 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'),
  });
}

export async function readYdbReferenceMappingEvidence(
  adapter: YdbAdapter,
): Promise<Readonly<YdbReferenceMappingEvidence>> {
  const accountResult = await adapter.read<AccountReferenceRow>(readStatement(
    'SELECT id, normalized_source_label, currency FROM accounts '
      + 'WHERE normalized_source_label IS NOT NULL',
  ));
  const categoryResult = await adapter.read<CategoryReferenceRow>(readStatement(
    'SELECT id, kind, normalized_source_label FROM categories '
      + 'WHERE normalized_source_label IS NOT NULL',
  ));

  const accounts = accountResult.rows.map(accountMapping)
    .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel)
      || left.accountId.localeCompare(right.accountId));
  const categories = categoryResult.rows.map(categoryMapping)
    .sort((left, right) => left.kind.localeCompare(right.kind)
      || left.sourceLabel.localeCompare(right.sourceLabel)
      || left.categoryId.localeCompare(right.categoryId));

  return Object.freeze({
    accounts: Object.freeze(accounts),
    categories: Object.freeze(categories),
  });
}
