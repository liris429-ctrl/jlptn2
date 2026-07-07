import type { FavoriteKind } from "../favorites/favoritesStore.ts";

/**
 * Separate from favoritesStore's data (different storage key) on purpose: favorites
 * are something the user chose to bookmark, weak words are auto-flagged by quiz
 * results in 暗記模式. Merging them would mean correctly recalling a word during a
 * quiz could silently un-favorite it if the user had bookmarked it for unrelated
 * reasons - a surprising cross-contamination bug.
 */
const STORAGE_KEY = "n2-weak-words";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function load(): Set<string> {
  if (!hasLocalStorage()) return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persist(weak: Set<string>): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...weak]));
  } catch {
    // Storage unavailable (private browsing quota etc.) - weak list stays in-memory for this session.
  }
}

function makeKey(kind: FavoriteKind, id: string): string {
  return `${kind}:${id}`;
}

let weak = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function isWeak(kind: FavoriteKind, id: string): boolean {
  return weak.has(makeKey(kind, id));
}

export function markWeak(kind: FavoriteKind, id: string): void {
  weak.add(makeKey(kind, id));
  persist(weak);
  emit();
}

export function clearWeak(kind: FavoriteKind, id: string): void {
  weak.delete(makeKey(kind, id));
  persist(weak);
  emit();
}

export function listWeakIds(kind: FavoriteKind): string[] {
  const prefix = `${kind}:`;
  return [...weak].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
}

export function subscribeWeak(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: reset in-memory state so each test starts clean. */
export function _resetWeakForTest(): void {
  weak = new Set();
  listeners.clear();
}
