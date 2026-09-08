import { sanitizeReaderResponse } from './presentation.mjs';

const DB_NAME = 'prihrash-reader';
const DB_VERSION = 1;
const STORE_NAME = 'cache';
const CACHE_KEY = 'recent-operations-v1';
const CACHE_SCHEMA_VERSION = 1;

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

export function createIndexedDbReaderCache(indexedDb = globalThis.indexedDB) {
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
        raw = await withStore('readonly', (store) => requestResult(store.get(CACHE_KEY)));
      } catch {
        throw new Error('READER_CACHE_READ_FAILED');
      }
      if (raw === undefined) return null;
      try {
        return parseReaderCacheRecord(raw);
      } catch {
        try {
          await withStore('readwrite', (store) => requestResult(store.delete(CACHE_KEY)));
        } catch {
          // A malformed cache is ignored even if cleanup cannot complete.
        }
        return null;
      }
    },

    async write(response, savedAt) {
      const record = createReaderCacheRecord(response, savedAt);
      try {
        await withStore('readwrite', (store) => requestResult(store.put(record, CACHE_KEY)));
      } catch {
        throw new Error('READER_CACHE_WRITE_FAILED');
      }
    },

    async clear() {
      try {
        await withStore('readwrite', (store) => requestResult(store.delete(CACHE_KEY)));
      } catch {
        throw new Error('READER_CACHE_CLEAR_FAILED');
      }
    },
  });
}
