import {
  runScheduledSyncJobFromEnvironment,
  type ScheduledSyncJobEnvironment,
} from './scheduledSyncJob.js';
import type { ScheduledSyncInvocationResult } from '../migration/scheduledSyncInvocation.js';
import {
  runScheduledSyncReadinessProbeFromEnvironment,
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
): Promise<Readonly<ScheduledSyncReadinessResult>> {
  return runReadiness(environment);
}

export async function readinessHandler(
  _event: unknown,
  _context: unknown,
): Promise<Readonly<ScheduledSyncReadinessResult>> {
  return executeYandexScheduledSyncReadinessFunction(
    process.env,
    runScheduledSyncReadinessProbeFromEnvironment,
  );
}
