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
      stagingRetirementEvidence?: InitialBootstrapRecoveryJobResult['stagingRetirementEvidence'];
      stagingSourceDecodeEvidence?: InitialBootstrapRecoveryJobResult['stagingSourceDecodeEvidence'];
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

const STAGING_RETIREMENT_EVIDENCE = new Set<NonNullable<InitialBootstrapRecoveryJobResult['stagingRetirementEvidence']>>([
  'STALE_STAGING_CURRENT_STATE_EMPTY',
  'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
  'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED',
]);

const SOURCE_DECODE_ERROR_CODES = new Set([
  'INVALID_PAYLOAD_SCHEMA',
  'UNRECOGNIZED_FINANCIAL_OPERATION_TYPE',
  'INVALID_DATE_CELL',
  'INVALID_DATE_SERIAL',
  'INVALID_AMOUNT_CELL',
  'INVALID_AMOUNT_DECIMAL',
  'INVALID_AMOUNT_SCALE',
  'AMOUNT_OUT_OF_RANGE',
  'INVALID_TEXT_CELL',
]);

const SOURCE_DECODE_FIELDS = new Set([
  'adapter_schema_version',
  'date',
  'operation_type',
  'expense_account',
  'expense_category',
  'description',
  'expense_amount',
  'income_account',
  'income_category',
  'income_amount',
  'vika_flag',
  'note',
]);

function validSourceDecodeEvidence(
  value: InitialBootstrapRecoveryJobResult['stagingSourceDecodeEvidence'],
): boolean {
  if (value === 'SOURCE_DECODE_DIAGNOSTIC_FAILED') return true;
  if (!Array.isArray(value)) return false;
  const tokens: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(',') !== 'errorCode,field') return false;
    if (typeof candidate.errorCode !== 'string' || !SOURCE_DECODE_ERROR_CODES.has(candidate.errorCode)) {
      return false;
    }
    if (typeof candidate.field !== 'string' || !SOURCE_DECODE_FIELDS.has(candidate.field)) return false;
    tokens.push(`${candidate.errorCode}@${candidate.field}`);
  }
  if (new Set(tokens).size !== tokens.length) return false;
  return tokens.every((token, index) => index === 0 || tokens[index - 1]! < token);
}

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
  'STALE_STAGING_RETIRED',
  'COMMITTED_ROWS_SEEN_MISSING',
  'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID',
  'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID',
  'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH',
  'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH',
]);

function validClassification(value: Readonly<InitialBootstrapRecoveryJobResult>): boolean {
  const diagnostic = value.stagingRevisionEvidence;
  const durableDiagnostic = value.stagingDurableRevisionEvidence;
  const retirementDiagnostic = value.stagingRetirementEvidence;
  const sourceDecodeDiagnostic = value.stagingSourceDecodeEvidence;
  if (value.reason === 'STAGING_RUN_PRESENT') {
    if (diagnostic === undefined || !STAGING_REVISION_EVIDENCE.has(diagnostic)) return false;
    if (durableDiagnostic === undefined || !STAGING_DURABLE_REVISION_EVIDENCE.has(durableDiagnostic)) return false;
    if (retirementDiagnostic === undefined || !STAGING_RETIREMENT_EVIDENCE.has(retirementDiagnostic)) return false;
    if (sourceDecodeDiagnostic === undefined || !validSourceDecodeEvidence(sourceDecodeDiagnostic)) return false;
  } else if (
    diagnostic !== undefined
    || durableDiagnostic !== undefined
    || retirementDiagnostic !== undefined
    || sourceDecodeDiagnostic !== undefined
  ) {
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
      ...(classification.stagingRetirementEvidence === undefined
        ? {}
        : { stagingRetirementEvidence: classification.stagingRetirementEvidence }),
      ...(classification.stagingSourceDecodeEvidence === undefined
        ? {}
        : { stagingSourceDecodeEvidence: classification.stagingSourceDecodeEvidence }),
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
