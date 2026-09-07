import { JWT } from 'google-auth-library';
import type { GoogleSheetsAccessTokenProvider } from './googleSheetsFullSnapshotReader.js';

export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export interface GoogleServiceAccountCredentials {
  readonly clientEmail: string;
  readonly privateKey: string;
}

export interface GoogleAccessTokenClient {
  getAccessToken(): Promise<string | null>;
}

export type GoogleServiceAccountTokenProviderErrorCode =
  | 'INVALID_SERVICE_ACCOUNT_EMAIL'
  | 'INVALID_SERVICE_ACCOUNT_PRIVATE_KEY'
  | 'TOKEN_ACQUISITION_FAILED'
  | 'INVALID_ACCESS_TOKEN';

export class GoogleServiceAccountTokenProviderError extends Error {
  readonly code: GoogleServiceAccountTokenProviderErrorCode;

  constructor(code: GoogleServiceAccountTokenProviderErrorCode) {
    super(code);
    this.name = 'GoogleServiceAccountTokenProviderError';
    this.code = code;
  }
}

function validateCredentials(credentials: Readonly<GoogleServiceAccountCredentials>): void {
  if (
    typeof credentials.clientEmail !== 'string'
    || credentials.clientEmail.length === 0
    || credentials.clientEmail !== credentials.clientEmail.trim()
    || !credentials.clientEmail.includes('@')
  ) {
    throw new GoogleServiceAccountTokenProviderError('INVALID_SERVICE_ACCOUNT_EMAIL');
  }
  if (
    typeof credentials.privateKey !== 'string'
    || credentials.privateKey.trim().length === 0
  ) {
    throw new GoogleServiceAccountTokenProviderError('INVALID_SERVICE_ACCOUNT_PRIVATE_KEY');
  }
}

export function createGoogleSheetsAccessTokenProviderFromClient(
  client: Readonly<GoogleAccessTokenClient>,
): Readonly<GoogleSheetsAccessTokenProvider> {
  return Object.freeze({
    async getAccessToken(): Promise<string> {
      let token: string | null;
      try {
        token = await client.getAccessToken();
      } catch {
        throw new GoogleServiceAccountTokenProviderError('TOKEN_ACQUISITION_FAILED');
      }
      if (typeof token !== 'string' || token.trim().length === 0) {
        throw new GoogleServiceAccountTokenProviderError('INVALID_ACCESS_TOKEN');
      }
      return token.trim();
    },
  });
}

export function createGoogleServiceAccountSheetsAccessTokenProvider(
  credentials: Readonly<GoogleServiceAccountCredentials>,
): Readonly<GoogleSheetsAccessTokenProvider> {
  validateCredentials(credentials);
  const client = new JWT({
    email: credentials.clientEmail,
    key: credentials.privateKey,
    scopes: [GOOGLE_SHEETS_READONLY_SCOPE],
  });
  return createGoogleSheetsAccessTokenProviderFromClient(client);
}
