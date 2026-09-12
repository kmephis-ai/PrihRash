import {
  readStatement,
  type YdbReadScope,
  type YdbStatement,
  type YdbTransaction,
  writeStatement,
} from '../integration/ydb/adapter.js';
import { utf8Parameter, uuidParameter } from '../integration/ydb/parameters.js';
import type { ReferenceResolver } from '../normalization/types.js';
import { buildReferenceResolverSnapshot } from './resolver.js';
import type { InitialReferenceBootstrapPlan } from './initialBootstrapReferencePlan.js';
import { readYdbReferenceMappingEvidence } from './ydbReferenceEvidenceReader.js';

export type InitialReferenceBootstrapPersistenceErrorCode =
  | 'ACCOUNT_REFERENCE_SEMANTICS_UNKNOWN'
  | 'VIKA_REFERENCE_CONFLICT'
  | 'REFERENCE_READBACK_MISMATCH';

export class InitialReferenceBootstrapPersistenceError extends Error {
  readonly code: InitialReferenceBootstrapPersistenceErrorCode;

  constructor(code: InitialReferenceBootstrapPersistenceErrorCode) {
    super(code);
    this.name = 'InitialReferenceBootstrapPersistenceError';
    this.code = code;
  }
}

const VIKA_MEMBER_NAME = 'Вика';
const ACTIVE_STATUS = 'ACTIVE';

type AccountReferenceKind = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'UNKNOWN';
type AccountReferenceBalanceNature = 'ASSET' | 'LIABILITY' | 'UNKNOWN';

interface AccountReferenceSemantics {
  readonly kind: AccountReferenceKind;
  readonly balanceNature: AccountReferenceBalanceNature;
}

const ACCOUNT_REFERENCE_SEMANTICS: Readonly<Record<string, Readonly<AccountReferenceSemantics>>> = Object.freeze({
  'Карта Visa': Object.freeze({ kind: 'DEBIT_CARD', balanceNature: 'ASSET' }),
  'Карта Credit': Object.freeze({ kind: 'CREDIT_CARD', balanceNature: 'LIABILITY' }),
  'Наличка': Object.freeze({ kind: 'CASH', balanceNature: 'ASSET' }),
  'Приход': Object.freeze({ kind: 'UNKNOWN', balanceNature: 'UNKNOWN' }),
});

interface VikaMemberRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
}

function accountReferenceSemantics(sourceLabel: string): Readonly<AccountReferenceSemantics> {
  const semantics = ACCOUNT_REFERENCE_SEMANTICS[sourceLabel];
  if (semantics === undefined) {
    throw new InitialReferenceBootstrapPersistenceError('ACCOUNT_REFERENCE_SEMANTICS_UNKNOWN');
  }
  return semantics;
}

export async function readCurrentVikaMemberId(scope: YdbReadScope): Promise<string | null> {
  const rows = (await scope.read<VikaMemberRow>(readStatement(
    'SELECT id, name, status FROM family_members WHERE name = $name',
    { name: utf8Parameter(VIKA_MEMBER_NAME) },
  ))).rows;
  if (rows.length === 0) return null;
  const row = rows[0];
  if (
    rows.length !== 1
    || row === undefined
    || row.name !== VIKA_MEMBER_NAME
    || row.status !== ACTIVE_STATUS
    || typeof row.id !== 'string'
  ) {
    throw new InitialReferenceBootstrapPersistenceError('VIKA_REFERENCE_CONFLICT');
  }
  return row.id;
}

export function prepareAccountReferenceInsert(
  id: string,
  sourceLabel: string,
): Readonly<YdbStatement> {
  const semantics = accountReferenceSemantics(sourceLabel);
  return writeStatement(
    'INSERT INTO accounts (id, name, kind, balance_nature, currency, status, normalized_source_label) '
      + 'VALUES ($id, $name, $kind, $balance_nature, $currency, $status, $normalized_source_label)',
    {
      id: uuidParameter(id),
      name: utf8Parameter(sourceLabel),
      kind: utf8Parameter(semantics.kind),
      balance_nature: utf8Parameter(semantics.balanceNature),
      currency: utf8Parameter('RUB'),
      status: utf8Parameter(ACTIVE_STATUS),
      normalized_source_label: utf8Parameter(sourceLabel),
    },
  );
}

export function prepareCategoryReferenceInsert(
  id: string,
  kind: 'EXPENSE' | 'INCOME',
  sourceLabel: string,
): Readonly<YdbStatement> {
  return writeStatement(
    'INSERT INTO categories (id, name, kind, status, normalized_source_label) '
      + 'VALUES ($id, $name, $kind, $status, $normalized_source_label)',
    {
      id: uuidParameter(id),
      name: utf8Parameter(sourceLabel),
      kind: utf8Parameter(kind),
      status: utf8Parameter(ACTIVE_STATUS),
      normalized_source_label: utf8Parameter(sourceLabel),
    },
  );
}

export function prepareVikaReferenceInsert(id: string): Readonly<YdbStatement> {
  return writeStatement(
    'INSERT INTO family_members (id, name, status) VALUES ($id, $name, $status)',
    {
      id: uuidParameter(id),
      name: utf8Parameter(VIKA_MEMBER_NAME),
      status: utf8Parameter(ACTIVE_STATUS),
    },
  );
}

function resolverMatchesPlan(
  resolver: Readonly<ReferenceResolver>,
  plan: Readonly<InitialReferenceBootstrapPlan>,
): boolean {
  if (resolver.vikaMemberId !== plan.vikaMemberId) return false;
  return plan.expectedAccounts.every((item) => (
    resolver.resolveAccountId(item.sourceLabel) === item.accountId
  )) && plan.expectedCategories.every((item) => (
    resolver.resolveCategoryId(item.kind, item.sourceLabel) === item.categoryId
  ));
}

export async function applyInitialReferenceBootstrapPlan(
  transaction: YdbTransaction,
  plan: Readonly<InitialReferenceBootstrapPlan>,
): Promise<void> {
  for (const statement of plan.writes) await transaction.execute(statement);
  const evidence = await readYdbReferenceMappingEvidence(transaction);
  const vikaMemberId = await readCurrentVikaMemberId(transaction);
  if (vikaMemberId === null) {
    throw new InitialReferenceBootstrapPersistenceError('REFERENCE_READBACK_MISMATCH');
  }
  const resolver = buildReferenceResolverSnapshot({ ...evidence, vikaMemberId });
  if (!resolverMatchesPlan(resolver, plan)) {
    throw new InitialReferenceBootstrapPersistenceError('REFERENCE_READBACK_MISMATCH');
  }
}
