import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateInitialStaleValidatedRecoveryGate } from '../../dist/migration/initialStaleValidatedRecoveryGate.js';

const base = Object.freeze({
  committedBaselinePresent: false,
  uniqueValidatedRun: true,
  validatedRunMetadataValid: true,
  sourceEvidence: 'AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH',
  historicalContextEvidence: 'RECONSTRUCTED_EXACT',
  currentStateEmpty: true,
  stagingCandidateExact: true,
  swapProvenNotApplied: true,
  inFlightProviderMutationAbsent: true,
  singleWriterExclusive: true,
});

test('stale VALIDATED gate is ready only when every marker-only predicate is proven', () => {
  assert.deepEqual(evaluateInitialStaleValidatedRecoveryGate(base), { status: 'READY_FOR_MARKER_ONLY' });
});

for (const [field, expected] of [
  ['committedBaselinePresent', 'COMMITTED_BASELINE_PRESENT'],
  ['uniqueValidatedRun', 'VALIDATED_RUN_NOT_UNIQUE'],
  ['validatedRunMetadataValid', 'VALIDATED_RUN_METADATA_INVALID'],
  ['historicalContextEvidence', 'HISTORICAL_CONTEXT_NOT_PROVEN'],
  ['currentStateEmpty', 'CURRENT_STATE_NOT_EMPTY'],
  ['stagingCandidateExact', 'STAGING_CANDIDATE_NOT_EXACT'],
  ['swapProvenNotApplied', 'SWAP_NOT_PROVEN_NOT_APPLIED'],
  ['inFlightProviderMutationAbsent', 'IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN'],
  ['singleWriterExclusive', 'SINGLE_WRITER_EXCLUSION_NOT_PROVEN'],
]) {
  test(`blocks when ${field} is not proven`, () => {
    const evidence = {
      ...base,
      [field]: field === 'committedBaselinePresent'
        ? true
        : field === 'historicalContextEvidence'
        ? 'NOT_PROVEN'
        : false,
    };
    assert.deepEqual(evaluateInitialStaleValidatedRecoveryGate(evidence), { status: 'BLOCKED', blocker: expected });
  });
}

test('accepts explicitly authorized temporal corroboration only together with exact NOT_APPLIED', () => {
  const temporal = {
    ...base,
    historicalContextEvidence: 'TEMPORALLY_CORROBORATED_WITH_EXACT_NOT_APPLIED',
  };
  assert.deepEqual(evaluateInitialStaleValidatedRecoveryGate(temporal), { status: 'READY_FOR_MARKER_ONLY' });
  assert.deepEqual(evaluateInitialStaleValidatedRecoveryGate({ ...temporal, swapProvenNotApplied: false }), {
    status: 'BLOCKED', blocker: 'SWAP_NOT_PROVEN_NOT_APPLIED',
  });
});

for (const sourceEvidence of [
  'AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED',
  'AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY',
  'AUTHORITATIVE_ROW_COUNT_MISMATCH',
  'AUTHORITATIVE_BINDING_MISMATCH',
  'AUTHORITATIVE_SNAPSHOT_MATCH',
  'VALIDATED_METADATA_INVALID',
  'VALIDATED_SOURCE_DIAGNOSTIC_FAILED',
]) {
  test(`rejects ${sourceEvidence} as stale drift proof`, () => {
    assert.deepEqual(evaluateInitialStaleValidatedRecoveryGate({ ...base, sourceEvidence }), { status: 'BLOCKED', blocker: 'SOURCE_DRIFT_NOT_PROVEN' });
  });
}
