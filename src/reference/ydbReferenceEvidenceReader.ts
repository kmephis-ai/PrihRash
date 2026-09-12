import { readStatement, type YdbAdapter, type YdbReadScope } from '../integration/ydb/adapter.js';
import { utf8Parameter } from '../integration/ydb/parameters.js';
import type { ReferenceResolver } from '../normalization/types.js';
import { normalizeSourceLabel, type CategoryKind } from './bootstrap.js';
import {
  buildReferenceResolverSnapshot,
  type AccountReferenceMapping,
  type CategoryReferenceMapping,
} from './resolver.js';

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

interface FamilyMemberReferenceRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
}

export interface YdbReferenceMappingEvidence {
  readonly accounts: readonly Readonly<AccountReferenceMapping>[];
  readonly categories: readonly Readonly<CategoryReferenceMapping>[];
}

export type YdbReferenceEvidenceReaderErrorCode =
  | 'MALFORMED_ACCOUNT_REFERENCE_EVIDENCE'
  | 'MALFORMED_CATEGORY_REFERENCE_EVIDENCE'
  | 'MALFORMED_VIKA_MEMBER_EVIDENCE'
  | 'VIKA_MEMBER_NOT_FOUND'
  | 'DUPLICATE_VIKA_MEMBER_EVIDENCE';

export class YdbReferenceEvidenceReaderError extends Error {
  readonly code: YdbReferenceEvidenceReaderErrorCode;

  constructor(code: YdbReferenceEvidenceReaderErrorCode) {
    super(code);
    this.name = 'YdbReferenceEvidenceReaderError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VIKA_MEMBER_NAME = 'Вика';
const ACTIVE_STATUS = 'ACTIVE';

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

async function readMappings(scope: YdbReadScope): Promise<Readonly<YdbReferenceMappingEvidence>> {
  const accountResult = await scope.read<AccountReferenceRow>(readStatement(
    'SELECT id, normalized_source_label, currency FROM accounts '
      + 'WHERE normalized_source_label IS NOT NULL',
  ));
  const categoryResult = await scope.read<CategoryReferenceRow>(readStatement(
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

function vikaMemberId(rows: readonly Readonly<FamilyMemberReferenceRow>[]): string {
  if (rows.length === 0) {
    throw new YdbReferenceEvidenceReaderError('VIKA_MEMBER_NOT_FOUND');
  }
  if (rows.length !== 1) {
    throw new YdbReferenceEvidenceReaderError('DUPLICATE_VIKA_MEMBER_EVIDENCE');
  }
  const row = rows[0];
  if (row === undefined || row.name !== VIKA_MEMBER_NAME || row.status !== ACTIVE_STATUS) {
    throw new YdbReferenceEvidenceReaderError('MALFORMED_VIKA_MEMBER_EVIDENCE');
  }
  return uuid(row.id, 'MALFORMED_VIKA_MEMBER_EVIDENCE');
}

export async function readYdbReferenceMappingEvidence(
  scope: YdbReadScope,
): Promise<Readonly<YdbReferenceMappingEvidence>> {
  return readMappings(scope);
}

export async function readYdbReferenceResolverSnapshot(
  adapter: YdbAdapter,
): Promise<Readonly<ReferenceResolver>> {
  return adapter.serializableReadWrite(async (transaction) => {
    const mappings = await readMappings(transaction);
    const memberResult = await transaction.read<FamilyMemberReferenceRow>(readStatement(
      'SELECT id, name, status FROM family_members WHERE name = $name AND status = $status',
      {
        name: utf8Parameter(VIKA_MEMBER_NAME),
        status: utf8Parameter(ACTIVE_STATUS),
      },
    ));
    return buildReferenceResolverSnapshot({
      ...mappings,
      vikaMemberId: vikaMemberId(memberResult.rows),
    });
  });
}
