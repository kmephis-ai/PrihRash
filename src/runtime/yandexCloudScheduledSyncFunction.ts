import {
  runScheduledSyncJobFromEnvironment,
  type ScheduledSyncJobEnvironment,
} from './scheduledSyncJob.js';
import type { ScheduledSyncInvocationResult } from '../migration/scheduledSyncInvocation.js';
import {
  ScheduledSyncReadinessError,
  runScheduledSyncReadinessProbeFromEnvironment,
  type ScheduledSyncReadinessErrorCode,
  type ScheduledSyncReadinessResult,
} from './scheduledSyncReadinessProbe.js';

const TIMER_EVENT_TYPE = 'yandex.cloud.events.serverless.triggers.TimerMessage';

export type YandexTimerScheduledSyncFunctionErrorCode = 'MALFORMED_TIMER_EVENT';

export class YandexTimerScheduledSyncFunctionError extends Error {
  readonly code: YandexTimerScheduledSyncFunctionErrorCode;

  constructor(code: YandexTimerScheduledSyncFunctionErrorCode) {
    super(code);
    this.name = 'YandexTimerScheduledSyncFunctionError';
    this.code = code;
  }
}

export interface YandexTimerScheduledSyncJob {
  (environment: ScheduledSyncJobEnvironment): Promise<Readonly<ScheduledSyncInvocationResult>>;
}

export interface YandexScheduledSyncReadinessJob {
  (environment: ScheduledSyncJobEnvironment): Promise<Readonly<ScheduledSyncReadinessResult>>;
}

export type YandexScheduledSyncReadinessFunctionErrorCode = 'READINESS_FAILED';

export interface YandexScheduledSyncReadinessFailureResult {
  readonly readinessFailure: ScheduledSyncReadinessErrorCode | YandexScheduledSyncReadinessFunctionErrorCode;
}

export type YandexScheduledSyncReadinessFunctionResult =
  | ScheduledSyncReadinessResult
  | YandexScheduledSyncReadinessFailureResult;

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function assertTimerEvent(event: unknown): void {
  const envelope = record(event);
  if (envelope === null || !Array.isArray(envelope.messages) || envelope.messages.length !== 1) {
    throw new YandexTimerScheduledSyncFunctionError('MALFORMED_TIMER_EVENT');
  }

  const message = record(envelope.messages[0]);
  const metadata = message === null ? null : record(message.event_metadata);
  if (metadata === null || metadata.event_type !== TIMER_EVENT_TYPE) {
    throw new YandexTimerScheduledSyncFunctionError('MALFORMED_TIMER_EVENT');
  }
}

export async function executeYandexTimerScheduledSyncFunction(
  event: unknown,
  environment: ScheduledSyncJobEnvironment,
  runJob: YandexTimerScheduledSyncJob,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  assertTimerEvent(event);
  return runJob(environment);
}

export async function handler(
  event: unknown,
  _context: unknown,
): Promise<Readonly<ScheduledSyncInvocationResult>> {
  return executeYandexTimerScheduledSyncFunction(
    event,
    process.env,
    runScheduledSyncJobFromEnvironment,
  );
}

export async function executeYandexScheduledSyncReadinessFunction(
  environment: ScheduledSyncJobEnvironment,
  runReadiness: YandexScheduledSyncReadinessJob,
): Promise<Readonly<YandexScheduledSyncReadinessFunctionResult>> {
  try {
    return await runReadiness(environment);
  } catch (error) {
    if (error instanceof ScheduledSyncReadinessError) {
      return Object.freeze({ readinessFailure: error.code });
    }
    return Object.freeze({ readinessFailure: 'READINESS_FAILED' as const });
  }
}

export async function readinessHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<YandexScheduledSyncReadinessFunctionResult>> {
  return executeYandexScheduledSyncReadinessFunction(
    process.env,
    runScheduledSyncReadinessProbeFromEnvironment,
  );
}
