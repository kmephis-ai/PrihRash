import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RECOVERY_TAG = 'r1-initial-bootstrap-recovery';
const MAX_CAPTURE_BYTES = 16 * 1024;
const INVOKE_TIMEOUT_MS = 180_000;

const SAFE_CONFIG_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKER_CONFIG_INVALID',
});
const SAFE_INVOKE_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED',
});
const SAFE_OUTPUT_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RECOVERY_INVOKE_OUTPUT_INVALID',
});
const VERDICTS = new Set(['APPLIED', 'NOT_APPLIED', 'RECOVERY_REQUIRED']);
const VALIDATED_SOURCE_EVIDENCE = new Set([
  'AUTHORITATIVE_SNAPSHOT_MATCH',
  'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  'AUTHORITATIVE_BINDING_MISMATCH',
  'VALIDATED_METADATA_INVALID',
  'VALIDATED_SOURCE_DIAGNOSTIC_FAILED',
]);
const STALE_VALIDATED_GATE_BLOCKERS = new Set([
  'COMMITTED_BASELINE_PRESENT',
  'VALIDATED_RUN_NOT_UNIQUE',
  'VALIDATED_RUN_METADATA_INVALID',
  'SOURCE_DRIFT_NOT_PROVEN',
  'HISTORICAL_CONTEXT_NOT_PROVEN',
  'CURRENT_STATE_NOT_EMPTY',
  'STAGING_CANDIDATE_NOT_EXACT',
  'SWAP_NOT_PROVEN_NOT_APPLIED',
  'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN',
  'SINGLE_WRITER_EXCLUSION_NOT_PROVEN',
]);

const STAGING_REVISION_EVIDENCE = new Set([
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
const STAGING_DURABLE_REVISION_EVIDENCE = new Set([
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
const STAGING_RETIREMENT_EVIDENCE = new Set([
  'STALE_STAGING_CURRENT_STATE_EMPTY',
  'STALE_STAGING_CURRENT_STATE_NOT_EMPTY',
  'STALE_STAGING_CURRENT_STATE_DIAGNOSTIC_FAILED',
]);

const STAGING_EXACT_REVISION_EVIDENCE = new Set([
  'EXACT_CURRENT_RUN_MATCH',
  'EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN',
  'EXACT_CURRENT_RUN_CARDINALITY_MISMATCH',
  'EXACT_CURRENT_RUN_REVISION_MALFORMED',
  'EXACT_CURRENT_RUN_REVISION_DUPLICATE',
  'EXACT_CURRENT_RUN_REVISION_UNEXPECTED_SOURCE',
  'EXACT_CURRENT_RUN_MIGRATION_RUN_MISMATCH',
  'EXACT_CURRENT_RUN_OBSERVED_AT_MISMATCH',
  'EXACT_CURRENT_RUN_ROW_HINT_MISMATCH',
  'EXACT_CURRENT_RUN_ROW_DIGEST_MISMATCH',
  'EXACT_CURRENT_RUN_CHANGE_CLASS_MISMATCH',
  'EXACT_CURRENT_RUN_RAW_PAYLOAD_MALFORMED',
  'EXACT_CURRENT_RUN_RAW_PAYLOAD_MISMATCH',
  'EXACT_CURRENT_RUN_DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_EVIDENCE = new Set([
  'READY',
  'BASELINE_EXISTS',
  'VALIDATION_BLOCKED',
  'YDB_QUERY_TIMEOUT',
  'YDB_DATA_SDK_SHAPE_INVALID',
  'YDB_DATA_PARAMETER_VALUE_INVALID',
  'YDB_DATA_PARAMETER_TYPE_UNSUPPORTED',
  'YDB_DATA_TIMESTAMP_PRECISION_UNSUPPORTED',
  'YDB_DATA_QUERY_EXECUTION_FAILED',
  'YDB_DATA_QUERY_EXECUTION_YDB_BAD_REQUEST',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNAUTHORIZED',
  'YDB_DATA_QUERY_EXECUTION_YDB_INTERNAL_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_ABORTED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE',
  'YDB_DATA_QUERY_EXECUTION_YDB_OVERLOADED',
  'YDB_DATA_QUERY_EXECUTION_YDB_SCHEME_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_GENERIC_ERROR',
  'YDB_DATA_QUERY_EXECUTION_YDB_BAD_SESSION',
  'YDB_DATA_QUERY_EXECUTION_YDB_PRECONDITION_FAILED',
  'YDB_DATA_QUERY_EXECUTION_YDB_ALREADY_EXISTS',
  'YDB_DATA_QUERY_EXECUTION_YDB_NOT_FOUND',
  'YDB_DATA_QUERY_EXECUTION_YDB_SESSION_EXPIRED',
  'YDB_DATA_QUERY_EXECUTION_YDB_CANCELLED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNDETERMINED',
  'YDB_DATA_QUERY_EXECUTION_YDB_UNSUPPORTED',
  'YDB_DATA_QUERY_EXECUTION_YDB_SESSION_BUSY',
  'YDB_DATA_QUERY_EXECUTION_YDB_EXTERNAL_ERROR',
  'YDB_DATA_CLIENT_CONFIG_INVALID',
  'DURABLE_RECONCILIATION_FAILURE',
  'REVISION_EVIDENCE_FAILURE',
  'PRIVATE_EVIDENCE_FAILURE',
  'APPLICATION_MULTIPLE_INCOMPLETE_RUNS',
  'APPLICATION_BOOTSTRAP_OBSERVATION_INVALID',
  'APPLICATION_RESUME_RUN_COUNTERS_MISMATCH',
  'APPLICATION_RESUME_COUNTER_REFINEMENT_CONFLICT',
  'APPLICATION_SNAPSHOT_EVIDENCE_MISSING',
  'APPLICATION_SNAPSHOT_EVIDENCE_AMBIGUOUS',
  'APPLICATION_SNAPSHOT_EVIDENCE_MISMATCH',
  'APPLICATION_CURRENT_STATE_NOT_EMPTY',
  'APPLICATION_PROMOTION_PREFLIGHT_DRIFT',
  'APPLICATION_CONTROLLED_CONTINUATION_RUN_MISSING',
  'APPLICATION_CONTROLLED_CONTINUATION_RUN_STATE_INVALID',
  'APPLICATION_CONTROLLED_CONTINUATION_ROUTE_NOT_REQUIRED',
  'DIAGNOSTIC_FAILED',
]);

const STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE = new Set([
  'UNOBSERVED',
  'NO_RETRY',
  'RETRIED',
  'NON_RETRYABLE',
  'EXHAUSTED',
  'DIAGNOSTIC_FAILED',
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

function validSourceDecodeEvidence(value) {
  if (value === 'SOURCE_DECODE_DIAGNOSTIC_FAILED') return true;
  if (!Array.isArray(value)) return false;
  const tokens = [];
  for (const entry of value) {
    const candidate = record(entry);
    if (candidate === null || !exactKeys(candidate, ['errorCode', 'field'])) return false;
    if (typeof candidate.errorCode !== 'string' || !SOURCE_DECODE_ERROR_CODES.has(candidate.errorCode)) return false;
    if (typeof candidate.field !== 'string' || !SOURCE_DECODE_FIELDS.has(candidate.field)) return false;
    tokens.push(`${candidate.errorCode}@${candidate.field}`);
  }
  if (new Set(tokens).size !== tokens.length) return false;
  return tokens.every((token, index) => index === 0 || tokens[index - 1] < token);
}

function formatSourceDecodeEvidence(value) {
  if (value === 'SOURCE_DECODE_DIAGNOSTIC_FAILED') return 'DIAGNOSTIC_FAILED';
  if (value.length === 0) return 'NONE';
  return value.map((entry) => `${entry.errorCode}@${entry.field}`).join(',');
}
const REASONS = new Set([
  'EMPTY_DURABLE_STATE',
  'COMMITTED_DURABLE_STATE',
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
  'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT',
  'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY',
  'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY',
  'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT',
  'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT',
  'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS',
  'VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED',
  'FAILED_RUN_PRESENT',
  'STALE_STAGING_RETIRED',
  'COMMITTED_ROWS_SEEN_MISSING',
  'COMMITTED_SOURCE_SNAPSHOT_COUNT_INVALID',
  'COMMITTED_IDENTITY_MANIFEST_COUNT_INVALID',
  'COMMITTED_SOURCE_RECORD_COUNT_MISMATCH',
  'COMMITTED_SOURCE_RECORD_REVISION_COUNT_MISMATCH',
]);
const FUNCTION_FAILURE_CODES = new Set([
  'INITIAL_BOOTSTRAP_RECOVERY_CONFIG_INVALID',
  'INITIAL_BOOTSTRAP_RECOVERY_RUNTIME_FAILED',
]);

function nonBlank(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function safeChildEnvironment(environment) {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME',
    'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'YC_IAM_TOKEN',
  ];
  return Object.fromEntries(
    allowed.filter((name) => nonBlank(environment[name])).map((name) => [name, environment[name]]),
  );
}

function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validPair(verdict, reason) {
  if (verdict === 'APPLIED') return reason === 'COMMITTED_DURABLE_STATE';
  if (verdict === 'NOT_APPLIED') return reason === 'EMPTY_DURABLE_STATE';
  return verdict === 'RECOVERY_REQUIRED'
    && reason !== 'COMMITTED_DURABLE_STATE'
    && reason !== 'EMPTY_DURABLE_STATE';
}

function parseExactResult(stdout, surfaceOnly = false, controlledPreparationOnly = false) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const result = record(value);
  if (result === null || typeof result.status !== 'string' || typeof result.code !== 'string') return null;

  if (
    result.status === 'PASS'
    && result.code === 'INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED'
    && typeof result.verdict === 'string'
    && VERDICTS.has(result.verdict)
    && typeof result.reason === 'string'
    && REASONS.has(result.reason)
    && validPair(result.verdict, result.reason)
  ) {
    const stagingRevisionEvidence = result.stagingRevisionEvidence;
    const stagingDurableRevisionEvidence = result.stagingDurableRevisionEvidence;
    const stagingRetirementEvidence = result.stagingRetirementEvidence;
    const stagingSourceDecodeEvidence = result.stagingSourceDecodeEvidence;
    const stagingExactRevisionEvidence = result.stagingExactRevisionEvidence;
    const stagingControlledPreparationEvidence = result.stagingControlledPreparationEvidence;
    const stagingControlledPreparationRetryEvidence = result.stagingControlledPreparationRetryEvidence;
    const validatedSourceEvidence = result.validatedSourceEvidence;
    const staleValidatedRecoveryGate = result.staleValidatedRecoveryGate;
    const noStagingDiagnostics = stagingRevisionEvidence === undefined
      && stagingDurableRevisionEvidence === undefined
      && stagingRetirementEvidence === undefined
      && stagingSourceDecodeEvidence === undefined
      && stagingExactRevisionEvidence === undefined;
    const validDiagnosticShape = controlledPreparationOnly
      ? result.reason === 'STAGING_RUN_PRESENT'
        ? exactKeys(result, [
            'status',
            'code',
            'verdict',
            'reason',
            'stagingControlledPreparationEvidence',
            'stagingControlledPreparationRetryEvidence',
          ])
          && noStagingDiagnostics
          && typeof stagingControlledPreparationEvidence === 'string'
          && STAGING_CONTROLLED_PREPARATION_EVIDENCE.has(stagingControlledPreparationEvidence)
          && typeof stagingControlledPreparationRetryEvidence === 'string'
          && STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE.has(stagingControlledPreparationRetryEvidence)
        : exactKeys(result, ['status', 'code', 'verdict', 'reason'])
          && noStagingDiagnostics
          && stagingControlledPreparationEvidence === undefined
          && stagingControlledPreparationRetryEvidence === undefined
      : result.reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY' && !surfaceOnly
      ? exactKeys(result, ['status', 'code', 'verdict', 'reason', 'validatedSourceEvidence', 'staleValidatedRecoveryGate'])
        && VALIDATED_SOURCE_EVIDENCE.has(validatedSourceEvidence)
        && record(staleValidatedRecoveryGate) !== null
        && exactKeys(staleValidatedRecoveryGate, ['status', 'blocker'])
        && staleValidatedRecoveryGate.status === 'BLOCKED'
        && STALE_VALIDATED_GATE_BLOCKERS.has(staleValidatedRecoveryGate.blocker)
        && stagingControlledPreparationEvidence === undefined
        && stagingControlledPreparationRetryEvidence === undefined
      : result.reason === 'STAGING_RUN_PRESENT' && surfaceOnly
      ? exactKeys(result, ['status', 'code', 'verdict', 'reason'])
        && stagingControlledPreparationEvidence === undefined
        && stagingControlledPreparationRetryEvidence === undefined
      : result.reason === 'STAGING_RUN_PRESENT'
      ? exactKeys(result, [
          'status',
          'code',
          'verdict',
          'reason',
          'stagingRevisionEvidence',
          'stagingDurableRevisionEvidence',
          'stagingRetirementEvidence',
          'stagingSourceDecodeEvidence',
          'stagingExactRevisionEvidence',
        ])
        && typeof stagingRevisionEvidence === 'string'
        && STAGING_REVISION_EVIDENCE.has(stagingRevisionEvidence)
        && typeof stagingDurableRevisionEvidence === 'string'
        && STAGING_DURABLE_REVISION_EVIDENCE.has(stagingDurableRevisionEvidence)
        && typeof stagingRetirementEvidence === 'string'
        && STAGING_RETIREMENT_EVIDENCE.has(stagingRetirementEvidence)
        && validSourceDecodeEvidence(stagingSourceDecodeEvidence)
        && typeof stagingExactRevisionEvidence === 'string'
        && STAGING_EXACT_REVISION_EVIDENCE.has(stagingExactRevisionEvidence)
        && stagingControlledPreparationEvidence === undefined
        && stagingControlledPreparationRetryEvidence === undefined
      : exactKeys(result, ['status', 'code', 'verdict', 'reason'])
        && noStagingDiagnostics
        && stagingControlledPreparationEvidence === undefined
        && stagingControlledPreparationRetryEvidence === undefined;
    if (!validDiagnosticShape) return null;
    return Object.freeze({
      result: Object.freeze({
        status: 'PASS',
        code: result.code,
        verdict: result.verdict,
        reason: result.reason,
      }),
      validatedSourceEvidence: result.reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY' ? validatedSourceEvidence ?? null : null,
      staleValidatedRecoveryGate: result.reason === 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY'
        ? staleValidatedRecoveryGate ?? null
        : null,
      stagingRevisionEvidence: result.reason === 'STAGING_RUN_PRESENT' ? stagingRevisionEvidence ?? null : null,
      stagingDurableRevisionEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingDurableRevisionEvidence ?? null
        : null,
      stagingRetirementEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingRetirementEvidence ?? null
        : null,
      stagingSourceDecodeEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingSourceDecodeEvidence ?? null
        : null,
      stagingExactRevisionEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingExactRevisionEvidence ?? null
        : null,
      stagingControlledPreparationEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingControlledPreparationEvidence ?? null
        : null,
      stagingControlledPreparationRetryEvidence: result.reason === 'STAGING_RUN_PRESENT'
        ? stagingControlledPreparationRetryEvidence ?? null
        : null,
    });
  }
  if (
    result.status === 'FAIL'
    && FUNCTION_FAILURE_CODES.has(result.code)
    && exactKeys(result, ['status', 'code'])
  ) {
    return Object.freeze({
      result: Object.freeze({ status: 'FAIL', code: result.code }),
      stagingRevisionEvidence: null,
      staleValidatedRecoveryGate: null,
      stagingDurableRevisionEvidence: null,
      stagingRetirementEvidence: null,
      stagingSourceDecodeEvidence: null,
      stagingExactRevisionEvidence: null,
      stagingControlledPreparationEvidence: null,
      stagingControlledPreparationRetryEvidence: null,
    });
  }
  return null;
}

async function invokeRecovery(environment = process.env) {
  const functionId = environment.PRIHRASH_YANDEX_INITIAL_BOOTSTRAP_FUNCTION_ID;
  const ycBinary = environment.PRIHRASH_YC_BIN ?? 'yc';
  if (!nonBlank(functionId) || !nonBlank(ycBinary)) {
    return Object.freeze({
      result: SAFE_CONFIG_FAILURE,
      stagingRevisionEvidence: null,
      staleValidatedRecoveryGate: null,
      stagingDurableRevisionEvidence: null,
      stagingRetirementEvidence: null,
      stagingSourceDecodeEvidence: null,
      stagingExactRevisionEvidence: null,
      stagingControlledPreparationEvidence: null,
      stagingControlledPreparationRetryEvidence: null,
    });
  }

  try {
    const { stdout } = await execFileAsync(
      ycBinary,
      ['serverless', 'function', 'invoke', '--id', functionId, '--tag', RECOVERY_TAG, '--retry', '0', '--no-user-output'],
      {
        encoding: 'utf8',
        env: safeChildEnvironment(environment),
        timeout: INVOKE_TIMEOUT_MS,
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return parseExactResult(
      stdout,
      environment.RECOVERY_SURFACE_ONLY === '1',
      environment.RECOVERY_CONTROLLED_PREPARATION_ONLY === '1',
    ) ?? Object.freeze({
      result: SAFE_OUTPUT_FAILURE,
      stagingRevisionEvidence: null,
      staleValidatedRecoveryGate: null,
      stagingDurableRevisionEvidence: null,
      stagingRetirementEvidence: null,
      stagingSourceDecodeEvidence: null,
      stagingExactRevisionEvidence: null,
      stagingControlledPreparationEvidence: null,
      stagingControlledPreparationRetryEvidence: null,
    });
  } catch {
    return Object.freeze({
      result: SAFE_INVOKE_FAILURE,
      stagingRevisionEvidence: null,
      stagingDurableRevisionEvidence: null,
      stagingRetirementEvidence: null,
      stagingSourceDecodeEvidence: null,
      stagingExactRevisionEvidence: null,
      stagingControlledPreparationEvidence: null,
      stagingControlledPreparationRetryEvidence: null,
    });
  }
}

const invocation = await invokeRecovery();
if (invocation.validatedSourceEvidence != null) {
  process.stderr.write(`R1_VALIDATED_SOURCE_EVIDENCE=${invocation.validatedSourceEvidence}\n`);
}
if (invocation.staleValidatedRecoveryGate != null) {
  process.stderr.write(`R1_STALE_VALIDATED_GATE_BLOCKER=${invocation.staleValidatedRecoveryGate.blocker}\n`);
}
if (invocation.stagingRevisionEvidence !== null) {
  process.stderr.write(`R1_STAGING_REVISION_EVIDENCE=${invocation.stagingRevisionEvidence}\n`);
}
if (invocation.stagingDurableRevisionEvidence !== null) {
  process.stderr.write(
    `R1_STAGING_DURABLE_REVISION_EVIDENCE=${invocation.stagingDurableRevisionEvidence}\n`,
  );
}
if (invocation.stagingRetirementEvidence !== null) {
  process.stderr.write(`R1_STAGING_RETIREMENT_EVIDENCE=${invocation.stagingRetirementEvidence}\n`);
}
if (invocation.stagingSourceDecodeEvidence !== null) {
  process.stderr.write(
    `R1_STAGING_SOURCE_DECODE_EVIDENCE=${formatSourceDecodeEvidence(invocation.stagingSourceDecodeEvidence)}\n`,
  );
}
if (invocation.stagingExactRevisionEvidence !== null) {
  process.stderr.write(
    `R1_STAGING_EXACT_REVISION_EVIDENCE=${invocation.stagingExactRevisionEvidence}\n`,
  );
}
if (invocation.stagingControlledPreparationEvidence !== null) {
  process.stderr.write(
    `R1_STAGING_CONTROLLED_PREPARATION_EVIDENCE=${invocation.stagingControlledPreparationEvidence}\n`,
  );
}
if (invocation.stagingControlledPreparationRetryEvidence !== null) {
  process.stderr.write(
    `R1_STAGING_CONTROLLED_PREPARATION_RETRY_EVIDENCE=${invocation.stagingControlledPreparationRetryEvidence}\n`,
  );
}
process.stdout.write(`${JSON.stringify(invocation.result)}\n`);
if (invocation.result.status !== 'PASS') process.exitCode = 2;
