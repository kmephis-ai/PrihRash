import type { CanonicalTransaction } from '../domain/transaction.js';
import type { IncrementalSourceCurrentCandidatePlan } from './incrementalSourceCurrentCandidate.js';
import type {
  IncrementalSemanticTransitionDecision,
  IncrementalSemanticTransitionPlan,
} from './incrementalSemanticTransition.js';

export interface IncrementalPreviousTransactionCurrentEvidence {
  readonly id: string;
  readonly transaction: Readonly<CanonicalTransaction>;
  readonly version: number;
}

export interface IncrementalTransactionCurrentCandidate {
  readonly id: string;
  readonly transaction: Readonly<CanonicalTransaction>;
  readonly version: number;
}

export interface IncrementalTransactionCurrentCandidatePlan {
  readonly transactions: readonly Readonly<IncrementalTransactionCurrentCandidate>[];
  readonly promotionBlocker: 'UNRESOLVED_LINEAGE' | null;
}

export type IncrementalTransactionCurrentCandidateErrorCode =
  | 'INVALID_PREVIOUS_TRANSACTION_ID'
  | 'DUPLICATE_PREVIOUS_TRANSACTION_ID'
  | 'INVALID_PREVIOUS_TRANSACTION_VERSION'
  | 'DUPLICATE_SOURCE_RECORD_ID'
  | 'INVALID_SOURCE_TRANSACTION_LINK'
  | 'DUPLICATE_TRANSITION_SOURCE_ID'
  | 'TRANSITION_SOURCE_NOT_FOUND'
  | 'TRANSITION_BLOCKS_CANDIDATE'
  | 'SOURCE_TRANSACTION_LINK_MISMATCH'
  | 'SOURCE_SEMANTIC_MISMATCH'
  | 'PREVIOUS_TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_VERSION_MISMATCH'
  | 'CREATE_TRANSACTION_LINK_MISSING'
  | 'CREATE_TRANSACTION_ALREADY_EXISTS'
  | 'SOURCE_ONLY_TRANSACTION_LINK_PRESENT'
  | 'SOURCE_TRANSACTION_NOT_FOUND';

export class IncrementalTransactionCurrentCandidateError extends Error {
  readonly code: IncrementalTransactionCurrentCandidateErrorCode;

  constructor(code: IncrementalTransactionCurrentCandidateErrorCode) {
    super(code);
    this.name = 'IncrementalTransactionCurrentCandidateError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizedId(value: string): string {
  return value.toLowerCase();
}

function freezeTransaction(transaction: Readonly<CanonicalTransaction>): Readonly<CanonicalTransaction> {
  return Object.freeze({ ...transaction });
}

function freezeCandidate(
  candidate: IncrementalTransactionCurrentCandidate,
): Readonly<IncrementalTransactionCurrentCandidate> {
  return Object.freeze({
    id: candidate.id,
    transaction: freezeTransaction(candidate.transaction),
    version: candidate.version,
  });
}

function previousMap(
  previous: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
): ReadonlyMap<string, Readonly<IncrementalTransactionCurrentCandidate>> {
  const byId = new Map<string, Readonly<IncrementalTransactionCurrentCandidate>>();
  for (const item of previous) {
    if (!UUID_PATTERN.test(item.id)) {
      throw new IncrementalTransactionCurrentCandidateError('INVALID_PREVIOUS_TRANSACTION_ID');
    }
    const id = normalizedId(item.id);
    if (byId.has(id)) {
      throw new IncrementalTransactionCurrentCandidateError('DUPLICATE_PREVIOUS_TRANSACTION_ID');
    }
    if (!Number.isSafeInteger(item.version) || item.version < 1) {
      throw new IncrementalTransactionCurrentCandidateError('INVALID_PREVIOUS_TRANSACTION_VERSION');
    }
    byId.set(id, freezeCandidate({ id, transaction: item.transaction, version: item.version }));
  }
  return byId;
}

function sourceMap(
  sourcePlan: Readonly<IncrementalSourceCurrentCandidatePlan>,
): ReadonlyMap<string, IncrementalSourceCurrentCandidatePlan['sourceRecords'][number]> {
  const byId = new Map<string, IncrementalSourceCurrentCandidatePlan['sourceRecords'][number]>();
  for (const record of sourcePlan.sourceRecords) {
    const id = normalizedId(record.id);
    if (byId.has(id)) {
      throw new IncrementalTransactionCurrentCandidateError('DUPLICATE_SOURCE_RECORD_ID');
    }
    if (record.transactionId !== null && !UUID_PATTERN.test(record.transactionId)) {
      throw new IncrementalTransactionCurrentCandidateError('INVALID_SOURCE_TRANSACTION_LINK');
    }
    byId.set(id, record);
  }
  return byId;
}

function decisionMap(
  transition: Readonly<IncrementalSemanticTransitionPlan>,
): ReadonlyMap<string, Readonly<IncrementalSemanticTransitionDecision>> {
  const byId = new Map<string, Readonly<IncrementalSemanticTransitionDecision>>();
  for (const decision of transition.decisions) {
    const id = normalizedId(decision.sourceRecordId);
    if (byId.has(id)) {
      throw new IncrementalTransactionCurrentCandidateError('DUPLICATE_TRANSITION_SOURCE_ID');
    }
    byId.set(id, decision);
  }
  return byId;
}

function requireSource(
  sourceById: ReadonlyMap<string, IncrementalSourceCurrentCandidatePlan['sourceRecords'][number]>,
  sourceRecordId: string,
): IncrementalSourceCurrentCandidatePlan['sourceRecords'][number] {
  const source = sourceById.get(normalizedId(sourceRecordId));
  if (source === undefined) {
    throw new IncrementalTransactionCurrentCandidateError('TRANSITION_SOURCE_NOT_FOUND');
  }
  return source;
}

function requirePreviousTransaction(
  transactions: ReadonlyMap<string, Readonly<IncrementalTransactionCurrentCandidate>>,
  transactionId: string,
): Readonly<IncrementalTransactionCurrentCandidate> {
  const previous = transactions.get(normalizedId(transactionId));
  if (previous === undefined) {
    throw new IncrementalTransactionCurrentCandidateError('PREVIOUS_TRANSACTION_NOT_FOUND');
  }
  return previous;
}

function assertSourceLink(
  source: IncrementalSourceCurrentCandidatePlan['sourceRecords'][number],
  transactionId: string | null,
): void {
  const actual = source.transactionId?.toLowerCase() ?? null;
  const expected = transactionId?.toLowerCase() ?? null;
  if (actual !== expected) {
    throw new IncrementalTransactionCurrentCandidateError('SOURCE_TRANSACTION_LINK_MISMATCH');
  }
}

function assertPreservedLinkExists(
  transactions: ReadonlyMap<string, Readonly<IncrementalTransactionCurrentCandidate>>,
  transactionId: string | null,
): void {
  if (transactionId !== null) {
    requirePreviousTransaction(transactions, transactionId);
  }
}

function assertSemantic(condition: boolean): void {
  if (!condition) {
    throw new IncrementalTransactionCurrentCandidateError('SOURCE_SEMANTIC_MISMATCH');
  }
}

export function buildIncrementalTransactionCurrentCandidatePlan(
  previousTransactions: readonly Readonly<IncrementalPreviousTransactionCurrentEvidence>[],
  transition: Readonly<IncrementalSemanticTransitionPlan>,
  sourcePlan: Readonly<IncrementalSourceCurrentCandidatePlan>,
): Readonly<IncrementalTransactionCurrentCandidatePlan> {
  const previousById = previousMap(previousTransactions);
  const sourceById = sourceMap(sourcePlan);
  const decisionsBySource = decisionMap(transition);
  const candidates = new Map(previousById);

  for (const [sourceRecordId, decision] of decisionsBySource) {
    const source = requireSource(sourceById, sourceRecordId);

    switch (decision.kind) {
      case 'BLOCK_VALIDATION':
        throw new IncrementalTransactionCurrentCandidateError('TRANSITION_BLOCKS_CANDIDATE');

      case 'CREATE_FINANCIAL_CANDIDATE': {
        if (source.classification !== 'FINANCIAL_RECORD' || source.state !== null || source.transactionId === null) {
          throw new IncrementalTransactionCurrentCandidateError('CREATE_TRANSACTION_LINK_MISSING');
        }
        const transactionId = normalizedId(source.transactionId);
        if (candidates.has(transactionId)) {
          throw new IncrementalTransactionCurrentCandidateError('CREATE_TRANSACTION_ALREADY_EXISTS');
        }
        candidates.set(transactionId, freezeCandidate({
          id: transactionId,
          transaction: decision.transaction,
          version: 1,
        }));
        break;
      }

      case 'CREATE_SOURCE_ONLY':
        assertSemantic(source.state === null && source.classification === decision.classification);
        if (source.transactionId !== null) {
          throw new IncrementalTransactionCurrentCandidateError('SOURCE_ONLY_TRANSACTION_LINK_PRESENT');
        }
        break;

      case 'CREATE_REVIEW_REQUIRED':
        assertSemantic(source.state === null && source.classification === 'AMBIGUOUS');
        if (source.transactionId !== null) {
          throw new IncrementalTransactionCurrentCandidateError('SOURCE_ONLY_TRANSACTION_LINK_PRESENT');
        }
        break;

      case 'OWNER_CORRECTION_REPLACE_CANDIDATE': {
        assertSemantic(source.state === null && source.classification === 'FINANCIAL_RECORD');
        assertSourceLink(source, decision.transactionId);
        const previous = requirePreviousTransaction(previousById, decision.transactionId);
        if (previous.version !== decision.expectedTransactionVersion) {
          throw new IncrementalTransactionCurrentCandidateError('TRANSACTION_VERSION_MISMATCH');
        }
        candidates.set(normalizedId(decision.transactionId), freezeCandidate({
          id: normalizedId(decision.transactionId),
          transaction: decision.transaction,
          version: previous.version + 1,
        }));
        break;
      }

      case 'WORKFLOW_TRANSFORM_PRESERVE_CANONICAL':
        assertSemantic(source.state === null && source.classification === 'FINANCIAL_RECORD');
        assertSourceLink(source, decision.transactionId);
        requirePreviousTransaction(previousById, decision.transactionId);
        break;

      case 'REVIEW_REQUIRED_PRESERVE':
        assertSemantic(source.state === null && source.classification === 'AMBIGUOUS');
        assertSourceLink(source, decision.transactionId);
        assertPreservedLinkExists(previousById, decision.transactionId);
        break;

      case 'MARK_MISSING_PRESERVE_CANONICAL':
        assertSemantic(source.state === 'MISSING');
        assertSourceLink(source, decision.transactionId);
        assertPreservedLinkExists(previousById, decision.transactionId);
        break;

      case 'TOUCH_PRESERVE':
        assertSemantic(source.state === null && source.classification === decision.classification);
        assertPreservedLinkExists(previousById, source.transactionId);
        break;
    }
  }

  for (const source of sourceById.values()) {
    if (source.transactionId !== null && !candidates.has(normalizedId(source.transactionId))) {
      throw new IncrementalTransactionCurrentCandidateError('SOURCE_TRANSACTION_NOT_FOUND');
    }
  }

  const transactions = [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    transactions: Object.freeze(transactions),
    promotionBlocker: sourcePlan.promotionBlocker,
  });
}
