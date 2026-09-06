import { YdbSchemeAdapter } from '../integration/ydb/scheme.js';
import type { InitialControlledRebuildSetupPlan } from './initialControlledRebuildSetup.js';

export interface InitialControlledRebuildSetupExecutionResult {
  readonly stagingDirectory: string;
  readonly directoryEnsured: boolean;
  readonly copiedTableCount: 2;
}

export type InitialControlledRebuildSetupExecutionErrorCode = 'INVALID_SETUP_PLAN';

export class InitialControlledRebuildSetupExecutionError extends Error {
  readonly code: InitialControlledRebuildSetupExecutionErrorCode;

  constructor(code: InitialControlledRebuildSetupExecutionErrorCode) {
    super(code);
    this.name = 'InitialControlledRebuildSetupExecutionError';
    this.code = code;
  }
}

const RUN_DIRECTORY_PATTERN = /^rebuild\/r_[0-9a-f]{32}$/;

function validatePlan(plan: Readonly<InitialControlledRebuildSetupPlan>): void {
  if (!RUN_DIRECTORY_PATTERN.test(plan.stagingDirectory) || plan.copyItems.length !== 2) {
    throw new InitialControlledRebuildSetupExecutionError('INVALID_SETUP_PLAN');
  }
  const expected = [
    { source: 'transactions', destination: `${plan.stagingDirectory}/transactions` },
    { source: 'source_records', destination: `${plan.stagingDirectory}/source_records` },
  ];
  for (const [index, item] of plan.copyItems.entries()) {
    const target = expected[index];
    if (target === undefined || item.source !== target.source || item.destination !== target.destination) {
      throw new InitialControlledRebuildSetupExecutionError('INVALID_SETUP_PLAN');
    }
  }
}

export async function executeInitialControlledRebuildSetup(
  adapter: YdbSchemeAdapter,
  plan: Readonly<InitialControlledRebuildSetupPlan>,
): Promise<Readonly<InitialControlledRebuildSetupExecutionResult>> {
  validatePlan(plan);
  if (plan.createDirectory) {
    await adapter.ensureDirectory(plan.stagingDirectory);
  }
  await adapter.copyTables(plan.copyItems.map((item) => ({
    source: item.source,
    destination: item.destination,
    omitIndexes: false,
  })));
  return Object.freeze({
    stagingDirectory: plan.stagingDirectory,
    directoryEnsured: plan.createDirectory,
    copiedTableCount: 2 as const,
  });
}
