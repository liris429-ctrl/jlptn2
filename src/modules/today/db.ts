/**
 * Minimal hand-rolled IndexedDB wrapper - this codebase has zero runtime
 * dependencies (see favoritesStore.ts/weakWordsStore.ts, both hand-rolled
 * localStorage stores), so this follows the same "no library" convention
 * rather than pulling in idb/dexie for what's really just a handful of
 * get/put/index-range calls.
 */
const DB_NAME = "n2tan-srs";
const DB_VERSION = 1;

export const STORE_WORD_STATE = "wordState";
export const STORE_DAILY_STATS = "dailyStats";
export const STORE_META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Opens (creating on first run) the SRS database once and caches the connection promise. */
export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_WORD_STATE)) {
          const store = db.createObjectStore(STORE_WORD_STATE, { keyPath: "key" });
          store.createIndex("srsDue", "srsDue");
          store.createIndex("lastWrongAt", "lastWrongAt");
          store.createIndex("firstSeenAt", "firstSeenAt");
          store.createIndex("mastery", "mastery");
          store.createIndex("fav", "fav");
        }
        if (!db.objectStoreNames.contains(STORE_DAILY_STATS)) {
          db.createObjectStore(STORE_DAILY_STATS, { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function dbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  return promisifyRequest(tx.objectStore(storeName).get(key));
}

export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  return promisifyRequest(tx.objectStore(storeName).getAll());
}

/** Range query against a named index - the whole point of the index/mastery/lastWrongAt
 * indexes declared above, so hot paths (due count, recent wrong) never scan the full store. */
export async function dbGetAllByIndexRange<T>(
  storeName: string,
  indexName: string,
  range: IDBKeyRange | null,
): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  return promisifyRequest(index.getAll(range ?? undefined));
}

export async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  return promisifyTx(tx);
}

/** Test-only: closes the cached connection (if any) and forgets it, so a
 * subsequent indexedDB.deleteDatabase() in test setup doesn't hang waiting
 * for a connection that would otherwise never close. */
export async function _resetDbForTest(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
