import type {
  InitialBootstrapRecoverySurfaceReason,
} from '../migration/initialBootstrapResidualSurface.js';
import type {
  InitialBootstrapRecoveryVerdict,
} from '../migration/initialBootstrapRecoveryProbe.js';
import {
  InitialBootstrapRecoveryJobError,
  runInitialBootstrapRecoveryJobFromEnvironment,
  type InitialBootstrapRecoveryJobEnvironment,
  type InitialBootstrapRecoveryJobResult,
} from './initialBootstrapRecoveryJob.js';

export type YandexInitialBootstrapRecoveryFunctionResult =
  | Readonly<{
      status: 'PASS';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED';
      verdict: InitialBootstrapRecoveryVerdict;
      reason: InitialBootstrapRecoverySurfaceReason;
      stagingRevisionEvidence?: InitialBootstrapRecoveryJobResult['stagingRevisionEvidence'];
      stagingDurableRevisionEvidence?: InitialBootstrapRecoveryJobResult['stagingDurableRevisionEvidence'];
    }>
  | Readonly<{
      status: 'FAIL';
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID' | 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED';
    }>;

export interface YandexInitialBootstrapRecoveryJob {
  (environment: InitialBootstrapRecoveryJobEnvironment): Promise<Readonly<InitialBootstrapRecoveryJobResult>>;
}


const STAGING_REVISION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingRevisionEvidence']>>([
  'NO_REVISION_EVIDENCE',
  'PARTIAL_CURRENT_RUN_ONLY',
  'COMPLETE_CURRENT_RUN_ONLY',
  'CROSS_RUN_PK_COLLISION',
  'STAGING_MANIFEST_CARDINALITY_MISMATCH',
  'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  'STAGING_DURABLE_METADATA_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  'AUTHORITATIVE_BINDING_MISMATCH',
  'REVISION_ROW_MALFORMED',
  'REVISION_ROW_DUPLICATE',
  'REVISION_ROW_UNEXPECTED_SOURCE',
  'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
]);

const STAGING_DURABLE_REVISION_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingDurableRevisionEvidence']>>([
  'NO_REVISION_EVIDENCE',
  'PARTIAL_CURRENT_RUN_ONLY',
  'COMPLETE_CURRENT_RUN_ONLY',
  'CROSS_RUN_PK_COLLISION',
  'STAGING_MANIFEST_CARDINALITY_MISMATCH',
  'STAGING_MANIFEST_STRUCTURE_MISMATCH',
  'STAGING_DURABLE_METADATA_MISMATCH',
  'REVISION_ROW_MALFORMED',
  'REVISION_ROW_DUPLICATE',
  'REVISION_ROW_UNEXPECTED_SOURCE',
  'REVISION_CURRENT_RUN_EVIDENCE_MISMATCH',
  'REVISION_EVIDENCE_DIAGNOSTIC_FAILED',
]);

const RECOVERY_REQUIRED_REASONS = new Set<InitialBootstrapRecoverySurfaceReason>([
  'READ_FAILED',
  'RUN_STATE_COUNT_INCONSISTENT',
  'RESIDUAL_STATE_WITHOUT_RUN',
  'RESIDUAL_REFERENCE_STATE_WITHOUT_RUN',
  'RESIDUAL_METADATA_STATE_WITHOUT_RUN',
  'RESIDUAL_CURRENT_OR_LINEAGE_STATE_WITHOUT_RUN',
  'RESIDUAL_MIXED_STATE_WITHOUT_RUN',
  'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  'RESIDUAL_REFERENCE_STATE_MISMATCH',
  'REFERENCE_RECONCILIATION_FAILED',
  'MULTIPLE_MIGRATION_RUNS',
  'STAGING_RUN_PRESENT',
  'VALIDATED_RUN_PRESENT',
  'FAILED_RUN_PRESENT',
  'COMMITTED_ROWS_SEEN_MISSING',
  'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID',
  'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID',
  'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH',
  'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH',
]);

function validClassification(value: Readonly<InitialBootstrapRecoveryJobResult>): boolean {
  const diagnostic = value.stagingRevisionEvidence;
  const durableDiagnostic = value.stagingDurableRevisionEvidence;
  if (value.reason === 'STAGING_RUN_PRESENT') {
    if (diagnostic === undefined || !STAGING_REVISION_EVIDENCE.has(diagnostic)) return false;
    if (durableDiagnostic === undefined || !STAGING_DURABLE_REVISION_EVIDENCE.has(durableDiagnostic)) return false;
  } else if (diagnostic !== undefined || durableDiagnostic !== undefined) {
    return false;
  }
  if (value.verdict === 'APPLIED') return value.reason === 'COMMITTED_DURABLE_STATE';
  if (value.verdict === 'NOT_APPLIED') return value.reason === 'EMPTY_DURABLE_STATE';
  return value.verdict === 'RECOVERY_REQUIRED' && RECOVERY_REQUIRED_REASONS.has(value.reason);
}

export async function executeYandexInitialBootstrapRecoveryFunction(
  environment: InitialBootstrapRecoveryJobEnvironment,
  runJob: YandexInitialBootstrapRecoveryJob,
): Promise<Readonly<YandexInitialBootstrapRecoveryFunctionResult>> {
  try {
    const classification = await runJob(environment);
    if (!validClassification(classification)) {
      return Object.freeze({
        status: 'FAIL' as const,
        code: 'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED' as const,
      });
    }
    return Object.freeze({
      status: 'PASS' as const,
      code: 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED' as const,
      verdict: classification.verdict,
      reason: classification.reason,
      ...(classification.stagingRevisionEvidence === undefined
        ? {}
        : { stagingRevisionEvidence: classification.stagingRevisionEvidence }),
      ...(classification.stagingDurableRevisionEvidence === undefined
        ? {}
        : { stagingDurableRevisionEvidence: classification.stagingDurableRevisionEvidence }),
    });
  } catch (error) {
    if (
      error instanceof InitialBootstrapRecoveryJobError
      && error.code.startsWith('INVALID_')
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
