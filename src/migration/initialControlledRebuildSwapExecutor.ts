import { YdbSchemeAdapter } from '../integration/ydb/scheme.js';
import type { ControlledInitialSwapPlan } from './initialControlledRebuildSwapGate.js';

export interface ControlledInitialSwapExecutionResult {
  readonly runId: string;
  readonly replacementCount: 2;
}

export type ControlledInitialSwapExecutionErrorCode = 'INVALID_SWAP_PLAN';

export class ControlledInitialSwapExecutionError extends Error {
  readonly code: ControlledInitialSwapExecutionErrorCode;

  constructor(code: ControlledInitialSwapExecutionErrorCode) {
    super(code);
    this.name = 'ControlledInitialSwapExecutionError';
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validatePlan(plan: Readonly<ControlledInitialSwapPlan>): void {
  const runId = plan.runId.toLowerCase();
  if (!UUID_PATTERN.test(runId) || plan.replacements.length !== 2) {
    throw new ControlledInitialSwapExecutionError('INVALID_SWAP_PLAN');
  }
  const directory = `rebuild/r_${runId.replaceAll('-', '')}`;
  const expected = [
    { source: `${directory}/transactions`, destination: 'transactions', replace: true },
    { source: `${directory}/source_records`, destination: 'source_records', replace: true },
  ];
  for (const [index, replacement] of plan.replacements.entries()) {
    const target = expected[index];
    if (
      target === undefined
      || replacement.source !== target.source
      || replacement.destination !== target.destination
      || replacement.replace !== true
    ) {
      throw new ControlledInitialSwapExecutionError('INVALID_SWAP_PLAN');
    }
  }
}

export async function executeControlledInitialSwap(
  adapter: YdbSchemeAdapter,
  plan: Readonly<ControlledInitialSwapPlan>,
): Promise<Readonly<ControlledInitialSwapExecutionResult>> {
  validatePlan(plan);
  await adapter.renameTables(plan.replacements);
  return Object.freeze({ runId: plan.runId.toLowerCase(), replacementCount: 2 as const });
}
