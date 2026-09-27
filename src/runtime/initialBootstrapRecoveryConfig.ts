export const INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV = Object.freeze({
  spreadsheetId: 'PRIHRASH_GOOGLE_SPREADSHEET_ID',
  googleServiceAccountEmail: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL',
  googleServiceAccountPrivateKey: 'PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ydbConnectionString: 'PRIHRASH_YDB_CONNECTION_STRING',
  privateHistoricalEvidence: 'PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE',
  causalBootstrapStartedAt: 'PRIHRASH_R1_RECOVERY_CAUSAL_BOOTSTRAP_STARTED_AT',
});

export type InitialBootstrapRecoveryJobEnvironment = Readonly<Record<string, string | undefined>>;

export interface InitialBootstrapRecoveryJobConfig {
  readonly spreadsheetId: string;
  readonly googleServiceAccountEmail: string;
  readonly googleServiceAccountPrivateKey: string;
  readonly ydbConnectionString: string;
  readonly privateHistoricalEvidence?: string;
  readonly causalBootstrapStartedAt?: string;
}

export type InitialBootstrapRecoveryJobErrorCode =
  | 'INVALID_SPREADSHEET_ID'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL'
  | 'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'
  | 'INVALID_YDB_CONNECTION_STRING'
  | 'INVALID_PRIVATE_HISTORICAL_EVIDENCE'
  | 'INVALID_CAUSAL_BOOTSTRAP_START_TIME'
  | 'INVALID_RECOVERY_MODE'
  | 'YDB_CLIENT_CLOSE_FAILED';

export class InitialBootstrapRecoveryJobError extends Error {
  readonly code: InitialBootstrapRecoveryJobErrorCode;

  constructor(code: InitialBootstrapRecoveryJobErrorCode) {
    super(code);
    this.name = 'InitialBootstrapRecoveryJobError';
    this.code = code;
  }
}

function requiredValue(value: unknown, code: InitialBootstrapRecoveryJobErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new InitialBootstrapRecoveryJobError(code);
  }
  return value;
}

function requiredSecret(value: unknown, code: InitialBootstrapRecoveryJobErrorCode): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InitialBootstrapRecoveryJobError(code);
  }
  return value;
}

function causalBootstrapStartedAt(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new InitialBootstrapRecoveryJobError('INVALID_CAUSAL_BOOTSTRAP_START_TIME');
  }
  return value;
}

export function validateInitialBootstrapRecoveryConfig(
  config: Readonly<InitialBootstrapRecoveryJobConfig>,
): Readonly<InitialBootstrapRecoveryJobConfig> {
  const privateHistoricalEvidence = config.privateHistoricalEvidence;
  const causalBootstrapStart = causalBootstrapStartedAt(config.causalBootstrapStartedAt);
  return Object.freeze({
    spreadsheetId: requiredValue(config.spreadsheetId, 'INVALID_SPREADSHEET_ID'),
    googleServiceAccountEmail: requiredValue(
      config.googleServiceAccountEmail,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_EMAIL',
    ),
    googleServiceAccountPrivateKey: requiredSecret(
      config.googleServiceAccountPrivateKey,
      'INVALID_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    ),
    ydbConnectionString: requiredValue(config.ydbConnectionString, 'INVALID_YDB_CONNECTION_STRING'),
    ...(privateHistoricalEvidence === undefined
      ? {}
      : {
          privateHistoricalEvidence: requiredSecret(
            privateHistoricalEvidence,
            'INVALID_PRIVATE_HISTORICAL_EVIDENCE',
          ),
        }),
    ...(causalBootstrapStart === undefined
      ? {}
      : { causalBootstrapStartedAt: causalBootstrapStart }),
  });
}

export function readInitialBootstrapRecoveryJobConfig(
  environment: InitialBootstrapRecoveryJobEnvironment,
): Readonly<InitialBootstrapRecoveryJobConfig> {
  const privateHistoricalEvidence = environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.privateHistoricalEvidence];
  const causalBootstrapStart = environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.causalBootstrapStartedAt];
  return validateInitialBootstrapRecoveryConfig({
    spreadsheetId: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.spreadsheetId] ?? '',
    googleServiceAccountEmail: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.googleServiceAccountEmail] ?? '',
    googleServiceAccountPrivateKey: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.googleServiceAccountPrivateKey] ?? '',
    ydbConnectionString: environment[INITIAL_BOOTSTRAP_RECOVERY_JOB_ENV.ydbConnectionString] ?? '',
    ...(privateHistoricalEvidence === undefined ? {} : { privateHistoricalEvidence }),
    ...(causalBootstrapStart === undefined || causalBootstrapStart.length === 0
      ? {}
      : { causalBootstrapStartedAt: causalBootstrapStart }),
  });
}
