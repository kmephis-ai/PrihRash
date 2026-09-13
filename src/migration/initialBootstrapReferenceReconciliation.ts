import { readStatement, type YdbAdapter } from '../integration/ydb/adapter.js';
import {
  INITIAL_REFERENCE_ACTIVE_STATUS,
  INITIAL_REFERENCE_VIKA_MEMBER_NAME,
  initialReferenceAccountSemantics,
} from '../reference/initialBootstrapReferenceSemantics.js';
import {
  deriveInitialReferenceBootstrapVocabulary,
  type InitialReferenceBootstrapObservationRow,
} from '../reference/initialBootstrapReferenceVocabulary.js';
import type { InitialBootstrapRecoverySurfaceClassification } from './initialBootstrapResidualSurface.js';

interface AccountRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly balance_nature?: unknown;
  readonly currency?: unknown;
  readonly status?: unknown;
  readonly normalized_source_label?: unknown;
}

interface CategoryRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly parent_id?: unknown;
  readonly status?: unknown;
  readonly sort_order?: unknown;
  readonly normalized_source_label?: unknown;
}

interface FamilyMemberRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
}

export interface InitialBootstrapReferenceStateEvidence {
  readonly accounts: readonly Readonly<AccountRow>[];
  readonly categories: readonly Readonly<CategoryRow>[];
  readonly familyMembers: readonly Readonly<FamilyMemberRow>[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function classification(
  reason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE'
    | 'RESIDUAL_REFERENCE_STATE_MISMATCH'
    | 'REFERENCE_RECONCILIATION_FAILED',
): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  return Object.freeze({ verdict: 'RECOVERY_REQUIRED' as const, reason });
}

function validUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function absent(value: unknown): boolean {
  return value === null || value === undefined;
}

function accountsMatch(
  expectedLabels: readonly string[],
  rows: readonly Readonly<AccountRow>[],
): boolean {
  if (rows.length !== expectedLabels.length) return false;
  const expected = new Set(expectedLabels);
  const seen = new Set<string>();

  for (const row of rows) {
    if (!validUuid(row.id) || typeof row.normalized_source_label !== 'string') return false;
    const sourceLabel = row.normalized_source_label;
    if (!expected.has(sourceLabel) || seen.has(sourceLabel)) return false;
    const semantics = initialReferenceAccountSemantics(sourceLabel);
    if (
      semantics === null
      || row.name !== sourceLabel
      || row.kind !== semantics.kind
      || row.balance_nature !== semantics.balanceNature
      || row.currency !== 'RUB'
      || row.status !== INITIAL_REFERENCE_ACTIVE_STATUS
    ) {
      return false;
    }
    seen.add(sourceLabel);
  }
  return seen.size === expected.size;
}

function categoriesMatch(
  expectedCategories: readonly Readonly<{ readonly kind: 'EXPENSE' | 'INCOME'; readonly sourceLabel: string }>[],
  rows: readonly Readonly<CategoryRow>[],
): boolean {
  if (rows.length !== expectedCategories.length) return false;
  const expected = new Set(expectedCategories.map((item) => `${item.kind}\u0000${item.sourceLabel}`));
  const seen = new Set<string>();

  for (const row of rows) {
    if (
      !validUuid(row.id)
      || (row.kind !== 'EXPENSE' && row.kind !== 'INCOME')
      || typeof row.normalized_source_label !== 'string'
    ) {
      return false;
    }
    const sourceLabel = row.normalized_source_label;
    const key = `${row.kind}\u0000${sourceLabel}`;
    if (
      !expected.has(key)
      || seen.has(key)
      || row.name !== sourceLabel
      || row.status !== INITIAL_REFERENCE_ACTIVE_STATUS
      || !absent(row.parent_id)
      || !absent(row.sort_order)
    ) {
      return false;
    }
    seen.add(key);
  }
  return seen.size === expected.size;
}

function familyMembersMatch(rows: readonly Readonly<FamilyMemberRow>[]): boolean {
  if (rows.length !== 1) return false;
  const row = rows[0];
  return row !== undefined
    && validUuid(row.id)
    && row.name === INITIAL_REFERENCE_VIKA_MEMBER_NAME
    && row.status === INITIAL_REFERENCE_ACTIVE_STATUS;
}

export function reconcileInitialBootstrapReferenceStateEvidence(
  rows: readonly Readonly<InitialReferenceBootstrapObservationRow>[],
  evidence: Readonly<InitialBootstrapReferenceStateEvidence>,
): Readonly<InitialBootstrapRecoverySurfaceClassification> {
  const expected = deriveInitialReferenceBootstrapVocabulary(rows);
  const matches = accountsMatch(
    expected.accounts.map((item) => item.sourceLabel),
    evidence.accounts,
  ) && categoriesMatch(expected.categories, evidence.categories)
    && familyMembersMatch(evidence.familyMembers);

  return classification(
    matches
      ? 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE'
      : 'RESIDUAL_REFERENCE_STATE_MISMATCH',
  );
}

export async function reconcileInitialBootstrapReferenceState(
  adapter: YdbAdapter,
  rows: readonly Readonly<InitialReferenceBootstrapObservationRow>[],
): Promise<Readonly<InitialBootstrapRecoverySurfaceClassification>> {
  try {
    const accounts = await adapter.read<AccountRow>(readStatement(
      'SELECT id, name, kind, balance_nature, currency, status, normalized_source_label FROM accounts',
    ));
    const categories = await adapter.read<CategoryRow>(readStatement(
      'SELECT id, name, kind, parent_id, status, sort_order, normalized_source_label FROM categories',
    ));
    const familyMembers = await adapter.read<FamilyMemberRow>(readStatement(
      'SELECT id, name, status FROM family_members',
    ));
    return reconcileInitialBootstrapReferenceStateEvidence(rows, Object.freeze({
      accounts: accounts.rows,
      categories: categories.rows,
      familyMembers: familyMembers.rows,
    }));
  } catch {
    return classification('REFERENCE_RECONCILIATION_FAILED');
  }
}
