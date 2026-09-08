import { sanitizeReaderResponse } from './presentation.mjs';
import { sanitizeReaderFilterOptions } from './reader-filters.mjs';

const DB_NAME = 'prihrash-reader';
const DB_VERSION = 1;
const STORE_NAME = 'cache';
const CACHE_KEY = 'recent-operations-v1';
const FILTER_OPTIONS_CACHE_KEY = 'reader-filter-options-v1';
const CACHE_SCHEMA_VERSION = 1;
const FILTER_OPTIONS_CACHE_SCHEMA_VERSION = 1;

function validSavedAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function createReaderCacheRecord(response, savedAt) {
  if (!validSavedAt(savedAt)) throw new Error('INVALID_READER_CACHE');
  return Object.freeze({
    schemaVersion: CACHE_SCHEMA_VERSION,
    apiVersion: 1,
    savedAt,
    response: sanitizeReaderResponse(response),
  });
}


export function createReaderFilterOptionsCacheRecord(response, savedAt) {
  if (!validSavedAt(savedAt)) throw new Error('INVALID_READER_FILTER_OPTIONS_CACHE');
  return Object.freeze({
    schemaVersion: FILTER_OPTIONS_CACHE_SCHEMA_VERSION,
    apiVersion: 1,
    savedAt,
    response: sanitizeReaderFilterOptions(response),
  });
}

export function parseReaderFilterOptionsCacheRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_READER_FILTER_OPTIONS_CACHE');
  if (value.schemaVersion !== FILTER_OPTIONS_CACHE_SCHEMA_VERSION || value.apiVersion !== 1 || !validSavedAt(value.savedAt)) {
    throw new Error('INVALID_READER_FILTER_OPTIONS_CACHE');
  }
  return createReaderFilterOptionsCacheRecord(value.response, value.savedAt);
}

export function parseReaderCacheRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_READER_CACHE');
  if (value.schemaVersion !== CACHE_SCHEMA_VERSION || value.apiVersion !== 1 || !validSavedAt(value.savedAt)) {
    throw new Error('INVALID_READER_CACHE');
  }
  return createReaderCacheRecord(value.response, value.savedAt);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('READER_CACHE_REQUEST_FAILED'));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('READER_CACHE_TRANSACTION_FAILED'));
    transaction.onabort = () => reject(new Error('READER_CACHE_TRANSACTION_FAILED'));
  });
}

function openDatabase(indexedDb) {
  if (!indexedDb || typeof indexedDb.open !== 'function') return Promise.reject(new Error('INDEXED_DB_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('READER_CACHE_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('READER_CACHE_OPEN_FAILED'));
  });
}

function createIndexedDbCache(indexedDb, { key, parseRecord, createRecord, readError, writeError, clearError }) {
  async function withStore(mode, action) {
    const db = await openDatabase(indexedDb);
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      const finished = transactionFinished(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const result = await action(store);
      await finished;
      return result;
    } finally {
      db.close();
    }
  }

  return Object.freeze({
    async read() {
      let raw;
      try {
        raw = await withStore('readonly', (store) => requestResult(store.get(key)));
      } catch {
        throw new Error(readError);
      }
      if (raw === undefined) return null;
      try {
        return parseRecord(raw);
      } catch {
        try {
          await withStore('readwrite', (store) => requestResult(store.delete(key)));
        } catch {
          // A malformed cache is ignored even if cleanup cannot complete.
        }
        return null;
      }
    },

    async write(response, savedAt) {
      const record = createRecord(response, savedAt);
      try {
        await withStore('readwrite', (store) => requestResult(store.put(record, key)));
      } catch {
        throw new Error(writeError);
      }
    },

    async clear() {
      try {
        await withStore('readwrite', (store) => requestResult(store.delete(key)));
      } catch {
        throw new Error(clearError);
      }
    },
  });
}

export function createIndexedDbReaderCache(indexedDb = globalThis.indexedDB) {
  return createIndexedDbCache(indexedDb, {
    key: CACHE_KEY,
    parseRecord: parseReaderCacheRecord,
    createRecord: createReaderCacheRecord,
    readError: 'READER_CACHE_READ_FAILED',
    writeError: 'READER_CACHE_WRITE_FAILED',
    clearError: 'READER_CACHE_CLEAR_FAILED',
  });
}

export function createIndexedDbReaderFilterOptionsCache(indexedDb = globalThis.indexedDB) {
  return createIndexedDbCache(indexedDb, {
    key: FILTER_OPTIONS_CACHE_KEY,
    parseRecord: parseReaderFilterOptionsCacheRecord,
    createRecord: createReaderFilterOptionsCacheRecord,
    readError: 'READER_FILTER_OPTIONS_CACHE_READ_FAILED',
    writeError: 'READER_FILTER_OPTIONS_CACHE_WRITE_FAILED',
    clearError: 'READER_FILTER_OPTIONS_CACHE_CLEAR_FAILED',
  });
}
