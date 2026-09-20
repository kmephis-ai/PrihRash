import {
  runInitialBootstrapStaleValidatedTerminalizationFromEnvironment,
  runInitialBootstrapStaleValidatedTerminalizationRecoveryFromEnvironment,
  type InitialBootstrapStaleValidatedGateBResult,
} from './initialBootstrapStaleValidatedTerminalizationJob.js';

type GateBMode = 'WRITE' | 'RECOVER';

function mode(event: unknown): GateBMode | null {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Readonly<Record<string, unknown>>;
  if (Object.keys(record).length !== 1 || (record.mode !== 'WRITE' && record.mode !== 'RECOVER')) return null;
  return record.mode;
}

function invalid(): InitialBootstrapStaleValidatedGateBResult {
  return Object.freeze({
    status: 'FAIL' as const,
    code: 'INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZATION_RUNTIME_FAILED' as const,
    reason: 'RUNTIME_FAILED' as const,
  });
}

export async function initialBootstrapStaleValidatedTerminalizationHandler(
  event: unknown,
  _context: unknown,
): Promise<InitialBootstrapStaleValidatedGateBResult> {
  const selected = mode(event);
  if (selected === null) return invalid();
  try {
    return selected === 'WRITE'
      ? await runInitialBootstrapStaleValidatedTerminalizationFromEnvironment(process.env)
      : await runInitialBootstrapStaleValidatedTerminalizationRecoveryFromEnvironment(process.env);
  } catch {
    return invalid();
  }
}
