import type { ReferenceResolver } from '../normalization/types.js';
import {
  accountBootstrapKey,
  categoryBootstrapKey,
  type CategoryKind,
} from './bootstrap.js';

export interface AccountReferenceMapping {
  readonly sourceLabel: string;
  readonly currency: 'RUB';
  readonly accountId: string;
}

export interface CategoryReferenceMapping {
  readonly kind: CategoryKind;
  readonly sourceLabel: string;
  readonly categoryId: string;
}

export interface ReferenceResolverSnapshotInput {
  readonly accounts: readonly Readonly<AccountReferenceMapping>[];
  readonly categories: readonly Readonly<CategoryReferenceMapping>[];
  readonly vikaMemberId: string;
}

export type ReferenceResolverSnapshotErrorCode =
  | 'INVALID_ACCOUNT_ID'
  | 'INVALID_CATEGORY_ID'
  | 'INVALID_VIKA_MEMBER_ID'
  | 'INVALID_ACCOUNT_CURRENCY'
  | 'DUPLICATE_ACCOUNT_SOURCE_KEY'
  | 'DUPLICATE_ACCOUNT_TARGET_ID'
  | 'DUPLICATE_CATEGORY_SOURCE_KEY'
  | 'DUPLICATE_CATEGORY_TARGET_ID';

export class ReferenceResolverSnapshotError extends Error {
  readonly code: ReferenceResolverSnapshotErrorCode;

  constructor(code: ReferenceResolverSnapshotErrorCode) {
    super(code);
    this.name = 'ReferenceResolverSnapshotError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function uuid(value: string, code: ReferenceResolverSnapshotErrorCode): string {
  if (!UUID_PATTERN.test(value)) throw new ReferenceResolverSnapshotError(code);
  return value.toLowerCase();
}

export function buildReferenceResolverSnapshot(
  input: Readonly<ReferenceResolverSnapshotInput>,
): Readonly<ReferenceResolver> {
  const accountByKey = new Map<string, string>();
  const accountIds = new Set<string>();
  for (const item of input.accounts) {
    if (item.currency !== 'RUB') {
      throw new ReferenceResolverSnapshotError('INVALID_ACCOUNT_CURRENCY');
    }
    const id = uuid(item.accountId, 'INVALID_ACCOUNT_ID');
    const key = accountBootstrapKey(item.sourceLabel);
    if (accountByKey.has(key)) {
      throw new ReferenceResolverSnapshotError('DUPLICATE_ACCOUNT_SOURCE_KEY');
    }
    if (accountIds.has(id)) {
      throw new ReferenceResolverSnapshotError('DUPLICATE_ACCOUNT_TARGET_ID');
    }
    accountByKey.set(key, id);
    accountIds.add(id);
  }

  const categoryByKey = new Map<string, string>();
  const categoryIds = new Set<string>();
  for (const item of input.categories) {
    const id = uuid(item.categoryId, 'INVALID_CATEGORY_ID');
    const key = categoryBootstrapKey(item.kind, item.sourceLabel);
    if (categoryByKey.has(key)) {
      throw new ReferenceResolverSnapshotError('DUPLICATE_CATEGORY_SOURCE_KEY');
    }
    if (categoryIds.has(id)) {
      throw new ReferenceResolverSnapshotError('DUPLICATE_CATEGORY_TARGET_ID');
    }
    categoryByKey.set(key, id);
    categoryIds.add(id);
  }

  const vikaMemberId = uuid(input.vikaMemberId, 'INVALID_VIKA_MEMBER_ID');

  return Object.freeze({
    vikaMemberId,
    resolveAccountId(sourceLabel: string): string | null {
      return accountByKey.get(accountBootstrapKey(sourceLabel)) ?? null;
    },
    resolveCategoryId(kind: CategoryKind, sourceLabel: string): string | null {
      return categoryByKey.get(categoryBootstrapKey(kind, sourceLabel)) ?? null;
    },
  });
}
