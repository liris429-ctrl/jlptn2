import { getStoreSync } from "../../data/store.ts";
import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { normalizeForSearch } from "../../utils/kana.ts";

export type SearchResultKind = "grammar" | "vocab";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  score: number;
  entry: GrammarEntry | VocabEntry;
}

interface SearchRecord {
  kind: SearchResultKind;
  id: string;
  normPrimary: string;
  normYomi: string;
  normMeaning: string;
  entry: GrammarEntry | VocabEntry;
}

let index: SearchRecord[] | null = null;

function buildIndex(): SearchRecord[] {
  const store = getStoreSync();
  const records: SearchRecord[] = [];
  for (const g of store.grammar) {
    records.push({
      kind: "grammar",
      id: g.id,
      normPrimary: normalizeForSearch(g.pattern),
      normYomi: "",
      normMeaning: normalizeForSearch(g.meaning),
      entry: g,
    });
  }
  for (const v of store.vocab) {
    records.push({
      kind: "vocab",
      id: v.id,
      normPrimary: normalizeForSearch(v.kanji),
      normYomi: normalizeForSearch(v.yomi),
      normMeaning: normalizeForSearch(v.meaning),
      entry: v,
    });
  }
  return records;
}

function scoreField(query: string, field: string): number {
  if (!field) return 0;
  if (field === query) return 100;
  if (field.startsWith(query)) return 80;
  if (field.includes(query)) return 50;
  return 0;
}

export interface SearchOptions {
  /** Restrict results to one kind, e.g. for the separate grammar/vocab tabs. */
  kind?: SearchResultKind;
  limit?: number;
}

/** Substring/prefix/exact scoring over kanji|pattern, yomi, and meaning at once. */
export function search(query: string, options: SearchOptions = {}): SearchResult[] {
  const { kind, limit = 50 } = options;
  index ??= buildIndex();
  const q = normalizeForSearch(query);
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const record of index) {
    if (kind && record.kind !== kind) continue;
    const score = Math.max(
      scoreField(q, record.normPrimary),
      scoreField(q, record.normYomi),
      scoreField(q, record.normMeaning),
    );
    if (score > 0) results.push({ kind: record.kind, id: record.id, score, entry: record.entry });
  }
  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return results.slice(0, limit);
}

export function resetSearchIndex(): void {
  index = null;
}
