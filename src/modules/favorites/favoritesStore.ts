export type FavoriteKind = "grammar" | "vocab";

const STORAGE_KEY = "n2-favorites";

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

function persist(favorites: Set<string>): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  } catch {
    // Storage unavailable (private browsing quota etc.) - favorites stay in-memory for this session.
  }
}

function makeKey(kind: FavoriteKind, id: string): string {
  return `${kind}:${id}`;
}

let favorites = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function isFavorite(kind: FavoriteKind, id: string): boolean {
  return favorites.has(makeKey(kind, id));
}

export function toggleFavorite(kind: FavoriteKind, id: string): void {
  const key = makeKey(kind, id);
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  persist(favorites);
  emit();
}

export function listFavoriteIds(kind: FavoriteKind): string[] {
  const prefix = `${kind}:`;
  return [...favorites]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: reset in-memory state so each test starts clean. */
export function _resetFavoritesForTest(): void {
  favorites = new Set();
  listeners.clear();
}
