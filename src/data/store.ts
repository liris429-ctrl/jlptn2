import type { DataStore, GrammarEntry, VocabEntry } from "./schema.ts";

interface Store extends DataStore {
  grammarById: Map<string, GrammarEntry>;
  vocabById: Map<string, VocabEntry>;
}

let storePromise: Promise<Store> | null = null;
let cached: Store | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Loads grammar.json + vocab.json once and caches the result for the whole app session. */
export function loadStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Promise.all([
      fetchJson<GrammarEntry[]>("/data/grammar.json"),
      fetchJson<VocabEntry[]>("/data/vocab.json"),
    ]).then(([grammar, vocab]) => {
      cached = {
        grammar,
        vocab,
        grammarById: new Map(grammar.map((g) => [g.id, g])),
        vocabById: new Map(vocab.map((v) => [v.id, v])),
      };
      return cached;
    });
  }
  return storePromise;
}

/** Synchronous access for code that only ever runs after loadStore() has resolved. */
export function getStoreSync(): Store {
  if (!cached) {
    throw new Error("Data store not loaded yet; call and await loadStore() first.");
  }
  return cached;
}
