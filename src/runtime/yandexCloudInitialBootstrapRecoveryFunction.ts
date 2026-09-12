import type { InitialBootstrapRecoveryVerdict } from '../migration/initialBootstrapRecoveryProbe.js';
import {
  InitialBootstrapRecoveryJobError,
  runInitialBootstrapRecoveryJobFromEnvironment,
  type InitialBootstrapRecoveryJobEnvironment,
} from './initialBootstrapRecoveryJob.js';

export type YandexInitialBootstrapRecoveryFunctionResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED';
      verdict: InitialBootstrapRecoveryVerdict;
    }>
  | Readonly<{
      status: 'FAIL';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID' | 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED';
    }>;

export interface YandexInitialBootstrapRecoveryJob {
  (environment: InitialBootstrapRecoveryJobEnvironment): Promise<InitialBootstrapRecoveryVerdict>;
}

export async function executeYandexInitialBootstrapRecoveryFunction(
  environment: InitialBootstrapRecoveryJobEnvironment,
  runJob: YandexInitialBootstrapRecoveryJob,
): Promise<Readonly<YandexInitialBootstrapRecoveryFunctionResult>> {
  try {
    const verdict = await runJob(environment);
    if (verdict !== 'APPLIED' && verdict !== 'NOT_APPLIED' && verdict !== 'RECOVERY_REQUIRED') {
      return Object.freeze({
        status: 'FAIL' as const,
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' as const,
      });
    }
    return Object.freeze({
      status: 'PASS' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED' as const,
      verdict,
    });
  } catch (error) {
    if (
      error instanceof InitialBootstrapRecoveryJobError
      && error.code === 'INVALID_YDB_CONNECTION_STRING'
    ) {
      return Object.freeze({
        status: 'FAIL' as const,
        code: 'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID' as const,
      });
    }
    return Object.freeze({
      status: 'FAIL' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' as const,
    });
  }
}

export async function initialBootstrapRecoveryHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexInitialBootstrapRecoveryFunctionResult>> {
  return executeYandexInitialBootstrapRecoveryFunction(
    process.env,
    runInitialBootstrapRecoveryJobFromEnvironment,
  );
}
