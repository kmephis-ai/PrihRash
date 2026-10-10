// Strict lifecycle-only readout; never include financial rows, counts, IDs or dates in output.
const STATES = new Set(['STAGING', 'VALIDATED', 'COMMITTED', 'FAILED']);

function safeCount(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return null;
}

export function classifyMigrationLifecycleGroups(resultSets) {
  if (!Array.isArray(resultSets) || resultSets.length !== 1
      || !Array.isArray(resultSets[0]) || resultSets[0].length > STATES.size) {
    return 'EVIDENCE_INVALID';
  }
  const groups = new Map();
  for (const row of resultSets[0]) {
    if (row === null || typeof row !== 'object'
        || !STATES.has(row.state) || groups.has(row.state)) return 'EVIDENCE_INVALID';
    const count = safeCount(row.row_count);
    if (count === null || count === 0n) return 'EVIDENCE_INVALID';
    groups.set(row.state, count);
  }
  if (groups.size === 0) return 'EMPTY_RUN_HISTORY_UNVERIFIED';
  const staging = groups.get('STAGING') ?? 0n;
  const validated = groups.get('VALIDATED') ?? 0n;
  if (staging > 0n && validated > 0n) return 'MULTIPLE_ACTIVE_STATES_RECOVERY_REQUIRED';
  if (staging > 1n) return 'MULTIPLE_STAGING_RECOVERY_REQUIRED';
  if (validated > 1n) return 'MULTIPLE_VALIDATED_RECOVERY_REQUIRED';
  if (staging > 0n) return 'STAGING_PRESENT_RECOVERY_REQUIRED';
  if (validated > 0n) return 'VALIDATED_PRESENT_RECOVERY_REQUIRED';
  if (groups.has('COMMITTED')) return 'COMMITTED_MARKER_UNVERIFIED';
  return 'FAILED_HISTORY_ONLY_UNVERIFIED';
}
