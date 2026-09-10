// Where downloaded student content lives on the device.
//
// Web: IndexedDB, which holds far more than localStorage's ~5 MB and is
// available on plain-http LAN addresses. Phones and tablets: AsyncStorage,
// one key per entry. Everything is namespaced by the signed-in user and wiped
// on sign-out or when a different user signs in on the same device.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const PREFIX = "localmind.offline.";
const DB_NAME = "localmind-offline";
const STORE = "entries";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function idb(): Promise<IDBDatabase | null> {
  if (Platform.OS !== "web" || typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export async function readEntry<T = unknown>(key: string): Promise<T | undefined> {
  const db = await idb();
  if (db) return tx<T>(db, "readonly", (s) => s.get(key));
  const raw = await AsyncStorage.getItem(PREFIX + key).catch(() => null);
  if (raw === null) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

export async function writeEntry(key: string, value: unknown): Promise<void> {
  const db = await idb();
  if (db) { await tx(db, "readwrite", (s) => s.put(value, key)); return; }
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
}

export async function writeMany(entries: Record<string, unknown>): Promise<void> {
  const db = await idb();
  if (db) { await tx(db, "readwrite", (s) => { for (const [k, v] of Object.entries(entries)) s.put(v, k); }); return; }
  await AsyncStorage.multiSet(Object.entries(entries).map(([k, v]) => [PREFIX + k, JSON.stringify(v)])).catch(() => {});
}

export async function clearAll(): Promise<void> {
  const db = await idb();
  if (db) { await tx(db, "readwrite", (s) => s.clear()); return; }
  const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith(PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => {});
}

// Meta keys live in the same store, under names no API path can have.
export const META = { owner: "@owner", me: "@me", lastSync: "@last-sync", version: "@version" };
