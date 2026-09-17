import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ENUM_SEGMENT = /^[A-Z][A-Z0-9_]*$/;

export class R1AutocontinueEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'R1AutocontinueEvidenceError';
    this.code = code;
  }
}

function fail(code) {
  throw new R1AutocontinueEvidenceError(code);
}

function record(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
  }
  return value;
}

function enumSegment(value) {
  if (typeof value !== 'string' || !ENUM_SEGMENT.test(value)) {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
  }
  return value;
}

function optionalEnumSegment(value) {
  if (value === null || value === undefined) return null;
  return enumSegment(value);
}

function signature(parts) {
  if (parts.length < 2 || parts.length > 4) {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
  }
  const normalized = parts.map(enumSegment).join('/');
  if (!/^[A-Z0-9_]+(?:\/[A-Z0-9_]+){1,3}$/.test(normalized)) {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
  }
  return normalized;
}

export function deriveBootstrapEvidenceSignature(input) {
  const evidence = record(input);
  const status = enumSegment(evidence.status);
  const code = enumSegment(evidence.code);
  if (status !== 'FAIL' && status !== 'STOP') {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_NOT_FAILURE');
  }

  if (code === 'INITIAL_BOOTSTRAP_RUNTIME_FAILED') {
    if (status !== 'FAIL') fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
    const runtimeCode = enumSegment(evidence.runtimeCode);
    const applicationPhase = optionalEnumSegment(evidence.applicationPhase);
    const metadataFailureCode = optionalEnumSegment(evidence.metadataFailureCode);
    const ydbDataFailureCode = optionalEnumSegment(evidence.ydbDataFailureCode);
    const staleRetirementFailureCode = optionalEnumSegment(evidence.staleRetirementFailureCode);
    const details = [metadataFailureCode, ydbDataFailureCode, staleRetirementFailureCode]
      .filter((value) => value !== null);
    if (details.length > 1) {
      fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_AMBIGUOUS');
    }
    const detail = details[0] ?? null;
    return applicationPhase === null
      ? signature([code, runtimeCode, ...(detail === null ? [] : [detail])])
      : signature([runtimeCode, applicationPhase, ...(detail === null ? [] : [detail])]);
  }

  if (code === 'INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED') {
    if (status !== 'FAIL') fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
    return signature([
      code,
      enumSegment(evidence.httpStatus),
      enumSegment(evidence.functionError),
    ]);
  }

  return signature([status, code]);
}

export function deriveOrchestratorEvidenceSignature(input) {
  const evidence = record(input);
  const status = enumSegment(evidence.status);
  const code = enumSegment(evidence.code);
  if (status !== 'FAIL' && status !== 'STOP') {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_NOT_FAILURE');
  }

  if (code === 'R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED') {
    return signature([
      code,
      enumSegment(evidence.postRecoveryVerdict),
      enumSegment(evidence.postRecoveryReason),
    ]);
  }
  if (code === 'R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED') {
    return signature([
      code,
      enumSegment(evidence.initialRecoveryVerdict),
      enumSegment(evidence.initialRecoveryReason),
    ]);
  }
  if (code === 'R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED') {
    const readinessCode = optionalEnumSegment(evidence.readinessCode);
    return readinessCode === null
      ? signature([status, code])
      : signature([code, readinessCode]);
  }
  return signature([status, code]);
}

export function decideAutocontinueAttempt({
  observedSignature,
  latestSignature,
  priorRootCauseAttempts,
}) {
  const observed = signature(String(observedSignature).split('/'));
  const latest = signature(String(latestSignature).split('/'));
  if (!Number.isSafeInteger(priorRootCauseAttempts) || priorRootCauseAttempts < 0) {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_HISTORY_INVALID');
  }
  if (observed !== latest) {
    return Object.freeze({ status: 'STOP', code: 'R1_BOOTSTRAP_AUTOCONTINUE_OBSERVED_SIGNATURE_MISMATCH' });
  }
  if (priorRootCauseAttempts >= 2) {
    return Object.freeze({ status: 'STOP', code: 'BLOCKED_NEEDS_ROOT_CAUSE' });
  }
  return Object.freeze({ status: 'PASS', code: 'R1_BOOTSTRAP_AUTOCONTINUE_ATTEMPT_READY' });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    fail('R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID');
  }
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'signature-bootstrap' && args.length === 1) {
    process.stdout.write(`${deriveBootstrapEvidenceSignature(await readJson(args[0]))}\n`);
    return;
  }
  if (command === 'signature-orchestrator' && args.length === 1) {
    process.stdout.write(`${deriveOrchestratorEvidenceSignature(await readJson(args[0]))}\n`);
    return;
  }
  if (command === 'decision' && args.length === 3) {
    const count = Number(args[2]);
    const result = decideAutocontinueAttempt({
      observedSignature: args[0],
      latestSignature: args[1],
      priorRootCauseAttempts: count,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  fail('R1_BOOTSTRAP_AUTOCONTINUE_ARGUMENTS_INVALID');
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof R1AutocontinueEvidenceError
      ? error.code
      : 'R1_BOOTSTRAP_AUTOCONTINUE_EVIDENCE_INVALID';
    process.stderr.write(`${code}\n`);
    process.exitCode = 2;
  });
}
