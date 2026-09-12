import type { YdbAdapter, YdbStatement } from '../integration/ydb/adapter.js';
import type { ReferenceResolver } from '../normalization/types.js';
import { accountBootstrapKey, categoryBootstrapKey } from './bootstrap.js';
import {
  prepareAccountReferenceInsert,
  prepareCategoryReferenceInsert,
  prepareVikaReferenceInsert,
  readCurrentVikaMemberId,
} from './initialBootstrapReferencePersistence.js';
import {
  deriveInitialReferenceBootstrapVocabulary,
  type InitialReferenceBootstrapObservationRow,
} from './initialBootstrapReferenceVocabulary.js';
import {
  buildReferenceResolverSnapshot,
  type AccountReferenceMapping,
  type CategoryReferenceMapping,
} from './resolver.js';
import { readYdbReferenceMappingEvidence } from './ydbReferenceEvidenceReader.js';

export interface InitialReferenceBootstrapIdentityAllocator {
  allocateReferenceId(): string;
}

export interface InitialReferenceBootstrapPlan {
  readonly resolver: Readonly<ReferenceResolver>;
  readonly expectedAccounts: readonly Readonly<AccountReferenceMapping>[];
  readonly expectedCategories: readonly Readonly<CategoryReferenceMapping>[];
  readonly vikaMemberId: string;
  readonly writes: readonly Readonly<YdbStatement>[];
}

export async function planInitialReferenceBootstrap(
  adapter: YdbAdapter,
  rows: readonly Readonly<InitialReferenceBootstrapObservationRow>[],
  allocator: Readonly<InitialReferenceBootstrapIdentityAllocator>,
): Promise<Readonly<InitialReferenceBootstrapPlan>> {
  const expected = deriveInitialReferenceBootstrapVocabulary(rows);

  return adapter.serializableReadWrite(async (transaction) => {
    const evidence = await readYdbReferenceMappingEvidence(transaction);
    const accountByKey = new Map(
      evidence.accounts.map((item) => [accountBootstrapKey(item.sourceLabel), item] as const),
    );
    const categoryByKey = new Map(
      evidence.categories.map((item) => [categoryBootstrapKey(item.kind, item.sourceLabel), item] as const),
    );
    const finalAccounts = [...evidence.accounts];
    const finalCategories = [...evidence.categories];
    const expectedAccounts: Readonly<AccountReferenceMapping>[] = [];
    const expectedCategories: Readonly<CategoryReferenceMapping>[] = [];
    const writes: Readonly<YdbStatement>[] = [];

    for (const account of expected.accounts) {
      const key = accountBootstrapKey(account.sourceLabel);
      let mapping = accountByKey.get(key);
      if (mapping === undefined) {
        mapping = Object.freeze({
          sourceLabel: account.sourceLabel,
          currency: 'RUB' as const,
          accountId: allocator.allocateReferenceId(),
        });
        accountByKey.set(key, mapping);
        finalAccounts.push(mapping);
        writes.push(prepareAccountReferenceInsert(mapping.accountId, mapping.sourceLabel));
      }
      expectedAccounts.push(mapping);
    }

    for (const category of expected.categories) {
      const key = categoryBootstrapKey(category.kind, category.sourceLabel);
      let mapping = categoryByKey.get(key);
      if (mapping === undefined) {
        mapping = Object.freeze({
          kind: category.kind,
          sourceLabel: category.sourceLabel,
          categoryId: allocator.allocateReferenceId(),
        });
        categoryByKey.set(key, mapping);
        finalCategories.push(mapping);
        writes.push(prepareCategoryReferenceInsert(mapping.categoryId, mapping.kind, mapping.sourceLabel));
      }
      expectedCategories.push(mapping);
    }

    const existingVikaMemberId = await readCurrentVikaMemberId(transaction);
    const vikaMemberId = existingVikaMemberId ?? allocator.allocateReferenceId();
    if (existingVikaMemberId === null) writes.push(prepareVikaReferenceInsert(vikaMemberId));

    const resolver = buildReferenceResolverSnapshot({
      accounts: finalAccounts,
      categories: finalCategories,
      vikaMemberId,
    });

    return Object.freeze({
      resolver,
      expectedAccounts: Object.freeze(expectedAccounts),
      expectedCategories: Object.freeze(expectedCategories),
      vikaMemberId: resolver.vikaMemberId,
      writes: Object.freeze(writes),
    });
  });
}
