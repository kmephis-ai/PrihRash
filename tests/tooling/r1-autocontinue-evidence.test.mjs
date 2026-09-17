import assert from 'node:assert/strict';
import test from 'node:test';

import {
  R1AutocontinueEvidenceError,
  decideAutocontinueAttempt,
  deriveBootstrapEvidenceSignature,
  deriveOrchestratorEvidenceSignature,
  selectArtifactIdAtOrBefore,
} from '../../scripts/r1-autocontinue-evidence.mjs';

function code(error, expected) {
  assert.equal(error instanceof R1AutocontinueEvidenceError, true);
  assert.equal(error.code, expected);
  return true;
}

test('bootstrap runtime evidence becomes the exact bounded observed signature', () => {
  assert.equal(deriveBootstrapEvidenceSignature({
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_APPLICATION_YDB_DATA_FAILED',
    applicationPhase: 'REVISION_EVIDENCE_WRITE',
    metadataFailureCode: null,
    ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    httpStatus: null,
    functionError: null,
  }), 'REFERENCE_APPLICATION_YDB_DATA_FAILED/REVISION_EVIDENCE_WRITE/YDB_TRANSPORT_QUERY_EXECUTION_FAILED');
});


test('stale-retirement semantic evidence becomes an exact bounded observed signature', () => {
  assert.equal(deriveBootstrapEvidenceSignature({
    status: 'FAIL',
    code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
    runtimeCode: 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED',
    applicationPhase: 'RESUME_CONTEXT_READ',
    metadataFailureCode: null,
    staleRetirementFailureCode: 'STALE_SNAPSHOT_NOT_PROVEN',
  }), 'REFERENCE_STALE_STAGING_RETIREMENT_FAILED/RESUME_CONTEXT_READ/STALE_SNAPSHOT_NOT_PROVEN');
});

test('bootstrap signature derivation is fail-closed for success and ambiguous runtime detail', () => {
  assert.throws(
    () => deriveBootstrapEvidenceSignature({ status: 'PASS', code: 'INITIAL_BOOTSTRAP_COMMITTED' }),
    (error) => code(error, 'R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_NOT_FAILURE'),
  );
  assert.throws(
    () => deriveBootstrapEvidenceSignature({
      status: 'FAIL',
      code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
      runtimeCode: 'REFERENCE_APPLICATION_YDB_DATA_FAILED',
      applicationPhase: 'REVISION_EVIDENCE_WRITE',
      metadataFailureCode: 'METADATA_EXECUTOR_RUN_READBACK_MISMATCH',
      ydbDataFailureCode: 'YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
      staleRetirementFailureCode: 'STALE_SNAPSHOT_NOT_PROVEN',
    }),
    (error) => code(error, 'R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_AMBIGUOUS'),
  );
});

test('orchestrator-only failure evidence has a deterministic safe signature', () => {
  assert.equal(deriveOrchestratorEvidenceSignature({
    status: 'STOP',
    code: 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED',
    postRecoveryVerdict: 'RECOVERY_REQUIRED',
    postRecoveryReason: 'RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE',
  }), 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED/RECOVERY_REQUIRED/RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE');
});

test('attempt decision requires exact evidence binding and blocks a third root-cause cycle', () => {
  const signature = 'REFERENCE_APPLICATION_YDB_DATA_FAILED/REVISION_EVIDENCE_WRITE/YDB_TRANSPORT_QUERY_EXECUTION_FAILED';
  assert.deepEqual(decideAutocontinueAttempt({
    observedSignature: signature,
    latestSignature: signature,
    priorRootCauseAttempts: 1,
  }), { status: 'PASS', code: 'R1_BOOTSTRAP_AUTOCONTINUE_ATTEMPT_READY' });

  assert.deepEqual(decideAutocontinueAttempt({
    observedSignature: signature,
    latestSignature: signature,
    priorRootCauseAttempts: 2,
  }), { status: 'STOP', code: 'BLOCKED_NEEDS_ROOT_CAUSE' });

  assert.deepEqual(decideAutocontinueAttempt({
    observedSignature: signature,
    latestSignature: 'REFERENCE_APPLICATION_YDB_DATA_FAILED/REVISION_EVIDENCE_READ/YDB_TRANSPORT_QUERY_EXECUTION_FAILED',
    priorRootCauseAttempts: 0,
  }), { status: 'STOP', code: 'R1_BOOTSTRAP_AUTOCONTINUE_OBSERVED_SIGNATURE_MISMATCH' });
});


test('historical artifact selection ignores rerun artifacts created after the orchestrator completed', () => {
  const artifactName = 'r1-initial-bootstrap-evidence-35186924018';
  const artifacts = {
    artifacts: [
      {
        id: 10482414057,
        name: artifactName,
        expired: false,
        created_at: '2026-09-17T05:50:36Z',
      },
      {
        id: 10483996299,
        name: artifactName,
        expired: false,
        created_at: '2026-09-17T06:24:41Z',
      },
    ],
  };

  assert.equal(selectArtifactIdAtOrBefore(artifacts, {
    artifactName,
    cutoff: '2026-09-17T05:52:48Z',
  }), 10482414057);
});

test('historical artifact selection stays fail-closed when more than one matching artifact existed before completion', () => {
  const artifactName = 'r1-initial-bootstrap-evidence-1';
  assert.throws(
    () => selectArtifactIdAtOrBefore({
      artifacts: [
        { id: 1, name: artifactName, expired: false, created_at: '2026-09-17T05:50:00Z' },
        { id: 2, name: artifactName, expired: false, created_at: '2026-09-17T05:51:00Z' },
      ],
    }, { artifactName, cutoff: '2026-09-17T05:52:00Z' }),
    (error) => code(error, 'R1_BOOTSTRAP_AUTOCONTINUE_ARTIFACT_HISTORY_AMBIGUOUS'),
  );
});
