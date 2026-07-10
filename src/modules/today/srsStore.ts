import type { GrammarEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { sample } from "../game/shuffle.ts";
import {
  dbGet,
  dbGetAll,
  dbGetAllByIndexRange,
  dbPut,
  openDb,
  STORE_DAILY_STATS,
  STORE_META,
  STORE_WORD_STATE,
} from "./db.ts";

export type AnswerSource = "game" | "anki" | "quiz" | "lookup";

export interface RecentEvent {
  r: 0 | 1;
  t: AnswerSource;
  ts: number;
}

export interface WordState {
  /** `${kind}:${id}` - see makeKey(). Adapted from the spec's plain `id` (with an
   * implied v/g prefix) because real VocabEntry/GrammarEntry ids are already
   * arbitrary slugs with no such guarantee, and this app already has a
   * kind:id compound-key convention (favoritesStore.ts/weakWordsStore.ts). */
  key: string;
  kind: FavoriteKind;
  id: string;
  seen: number;
  correct: number;
  recent: RecentEvent[];
  mastery: number;
  srsDue: string | null;
  srsInterval: number;
  lastReviewed: string | null;
  lastWrongAt: number | null;
  firstSeenAt: number;
  fav: boolean;
  note: string;
}

export interface DailyStats {
  date: string;
  answered: number;
  correct: number;
  games: Record<string, number>;
}

const RECENT_LIMIT = 10;
const SRS_LADDER = [1, 3, 7, 14, 30];
const WEAK_MASTERY_CEILING = 0.6;
const WEAK_MIN_SEEN = 3;
const RECENT_WRONG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_SUMMARY_MIN_ANSWERED = 20;
const WEEK_SUMMARY_DIFF_THRESHOLD_PCT = 5;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Fires after every recordAnswer/touchWord/setMeta write, so views know to re-query. */
export function subscribeSrs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function makeKey(kind: FavoriteKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Study-day attribution: hours before 4am count as the previous day, so a late
 * study session doesn't fracture a streak or land in tomorrow's stats. Every
 * date-of-day calculation in this module must go through this function -
 * never call `new Date()` directly to decide "what day is it".
 */
export function getStudyDate(ts: number = Date.now()): string {
  const d = new Date(ts);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Pure calendar-string arithmetic on an already-known study date - not a
 * "what day is it" question, so this is fine to base on new Date(y,m,d). */
function addDays(dateStr: string, days: number): string {
  const [y, m, day] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, day);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Calendar-day difference between two YYYY-MM-DD strings (dateStr - fromDateStr).
 * Pure date-string math, not a "what day is it" question, so this doesn't need
 * to route through getStudyDate() itself (though callers typically pass its output). */
export function daysUntil(dateStr: string, fromDateStr: string = getStudyDate()): number {
  const [ay, am, ad] = fromDateStr.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = dateStr.split("-").map(Number) as [number, number, number];
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

function nextInterval(current: number): number {
  for (const step of SRS_LADDER) {
    if (step > current) return step;
  }
  return SRS_LADDER[SRS_LADDER.length - 1]!;
}

function emptyWordState(kind: FavoriteKind, id: string, now: number): WordState {
  return {
    key: makeKey(kind, id),
    kind,
    id,
    seen: 0,
    correct: 0,
    recent: [],
    mastery: 0,
    srsDue: null,
    srsInterval: 0,
    lastReviewed: null,
    lastWrongAt: null,
    firstSeenAt: now,
    fav: false,
    note: "",
  };
}

/**
 * The single write path for an actual answer (game/anki/quiz/lookup). Updates
 * wordState's recent/mastery/SRS schedule and dailyStats in one transaction.
 */
export async function recordAnswer(
  kind: FavoriteKind,
  id: string,
  isCorrect: boolean,
  source: AnswerSource,
): Promise<void> {
  const now = Date.now();
  const today = getStudyDate(now);
  const key = makeKey(kind, id);

  const db = await openDb();
  const tx = db.transaction([STORE_WORD_STATE, STORE_DAILY_STATS], "readwrite");
  const wordStore = tx.objectStore(STORE_WORD_STATE);
  const statsStore = tx.objectStore(STORE_DAILY_STATS);

  const existing = await new Promise<WordState | undefined>((resolve, reject) => {
    const req = wordStore.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const state = existing ?? emptyWordState(kind, id, now);

  state.recent = [...state.recent, { r: isCorrect ? 1 : 0, t: source, ts: now }];
  if (state.recent.length > RECENT_LIMIT) {
    state.recent = state.recent.slice(state.recent.length - RECENT_LIMIT);
  }
  state.mastery = state.recent.filter((e) => e.r === 1).length / state.recent.length;
  state.seen += 1;
  if (isCorrect) {
    state.correct += 1;
    state.srsInterval = nextInterval(state.srsInterval);
    state.srsDue = addDays(today, state.srsInterval);
  } else {
    state.srsInterval = 1;
    state.srsDue = addDays(today, 1);
    state.lastWrongAt = now;
  }
  state.lastReviewed = today;
  wordStore.put(state);

  const statsExisting = await new Promise<DailyStats | undefined>((resolve, reject) => {
    const req = statsStore.get(today);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const stats: DailyStats = statsExisting ?? { date: today, answered: 0, correct: 0, games: {} };
  stats.answered += 1;
  if (isCorrect) stats.correct += 1;
  if (source === "game") {
    stats.games = { ...stats.games, pairing: (stats.games.pairing ?? 0) + 1 };
  }
  statsStore.put(stats);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  emit();
}

/**
 * A weak "seen this" signal for browsing into a detail page - only seeds a
 * schedule if the word has never been touched before; does nothing to an
 * existing record (browsing again isn't a re-test). List scrolling/card
 * peeking must never call this - only an actual detail-page visit.
 */
export async function touchWord(kind: FavoriteKind, id: string): Promise<void> {
  const key = makeKey(kind, id);
  const existing = await dbGet<WordState>(STORE_WORD_STATE, key);
  if (existing) return;
  const now = Date.now();
  const today = getStudyDate(now);
  const state = emptyWordState(kind, id, now);
  state.srsInterval = 3;
  state.srsDue = addDays(today, 3);
  await dbPut(STORE_WORD_STATE, state);
  emit();
}

/** srsDue <= today. Words with srsDue = null (never touched) are absent from
 * the index entirely, so they're never counted here - no explicit filter needed. */
export async function getDueCount(): Promise<number> {
  const range = IDBKeyRange.upperBound(getStudyDate());
  const rows = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "srsDue", range);
  return rows.length;
}

async function getWeakWords(): Promise<WordState[]> {
  const range = IDBKeyRange.upperBound(WEAK_MASTERY_CEILING, true);
  const rows = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "mastery", range);
  return rows.filter((w) => w.seen >= WEAK_MIN_SEEN);
}

export async function getWeakCount(): Promise<number> {
  return (await getWeakWords()).length;
}

/** lastWrongAt within the last 7 days, ranked by wrong-count desc then recency desc. */
export async function getRecentWrongEntries(limit = 5): Promise<WordState[]> {
  const range = IDBKeyRange.lowerBound(Date.now() - RECENT_WRONG_WINDOW_MS);
  const rows = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "lastWrongAt", range);
  const wrongCount = (w: WordState): number => w.recent.filter((e) => e.r === 0).length;
  rows.sort((a, b) => wrongCount(b) - wrongCount(a) || (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0));
  return rows.slice(0, limit);
}

/** dailyStats' keyPath (`date`) is itself the sortable range key - no extra index needed. */
export async function getDailyStatsRange(days: number): Promise<DailyStats[]> {
  const today = getStudyDate();
  const start = addDays(today, -(days - 1));
  const db = await openDb();
  const tx = db.transaction(STORE_DAILY_STATS, "readonly");
  const rows = await new Promise<DailyStats[]>((resolve, reject) => {
    const req = tx.objectStore(STORE_DAILY_STATS).getAll(IDBKeyRange.bound(start, today));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return rows;
}

/** Consecutive answered>0 days walking back from today; today itself only
 * counts if already answered (not yet studying today doesn't break the streak). */
export async function getStreak(): Promise<number> {
  let streak = 0;
  const today = getStudyDate();
  const todayStats = await dbGet<DailyStats>(STORE_DAILY_STATS, today);
  if (todayStats && todayStats.answered > 0) streak += 1;

  let cursor = addDays(today, -1);
  for (;;) {
    const stats = await dbGet<DailyStats>(STORE_DAILY_STATS, cursor);
    if (!stats || stats.answered <= 0) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface WeekSummary {
  totalAnswered: number;
  /** null when this week has under 20 answers - not enough data to show a rate. */
  accuracyPct: number | null;
  /** null when grammar/vocab accuracy differ by under 5 points, or either has no data. */
  weakerCategory: FavoriteKind | null;
}

export async function getWeekSummary(): Promise<WeekSummary> {
  const stats = await getDailyStatsRange(7);
  const totalAnswered = stats.reduce((sum, d) => sum + d.answered, 0);
  const totalCorrect = stats.reduce((sum, d) => sum + d.correct, 0);
  if (totalAnswered < WEEK_SUMMARY_MIN_ANSWERED) {
    return { totalAnswered, accuracyPct: null, weakerCategory: null };
  }
  const accuracyPct = Math.round((totalCorrect / totalAnswered) * 100);

  const cutoff = Date.now() - RECENT_WRONG_WINDOW_MS;
  const allWords = await dbGetAll<WordState>(STORE_WORD_STATE);
  const tally: Record<FavoriteKind, { right: number; total: number }> = {
    grammar: { right: 0, total: 0 },
    vocab: { right: 0, total: 0 },
  };
  for (const w of allWords) {
    for (const e of w.recent) {
      if (e.ts >= cutoff) {
        tally[w.kind].total += 1;
        tally[w.kind].right += e.r;
      }
    }
  }

  let weakerCategory: FavoriteKind | null = null;
  if (tally.grammar.total > 0 && tally.vocab.total > 0) {
    const grammarAcc = tally.grammar.right / tally.grammar.total;
    const vocabAcc = tally.vocab.right / tally.vocab.total;
    if (Math.abs(grammarAcc - vocabAcc) * 100 >= WEEK_SUMMARY_DIFF_THRESHOLD_PCT) {
      weakerCategory = grammarAcc < vocabAcc ? "grammar" : "vocab";
    }
  }
  return { totalAnswered, accuracyPct, weakerCategory };
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const rec = await dbGet<{ key: string; value: T }>(STORE_META, key);
  return rec?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await dbPut(STORE_META, { key, value });
  emit();
}

export interface PoolCounts {
  review: number;
  weak: number;
  new: number;
}

export interface DrawnWord {
  kind: FavoriteKind;
  id: string;
}

export interface DrawnPools {
  review: DrawnWord[];
  weak: DrawnWord[];
  new: DrawnWord[];
}

const LESSON_NUMBER = /^第(\d+)課/;

function grammarLessonNumber(entry: GrammarEntry): number | null {
  const match = entry.lesson ? LESSON_NUMBER.exec(entry.lesson) : null;
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/**
 * Draws up to `counts.review`/`counts.weak`/`counts.new` candidates from three
 * disjoint pools (a word picked for one pool is excluded from the others, so
 * the same word never appears twice - "同一詞不會重複"). `learnedUpTo` scopes
 * the new-word pool to grammar entries within that lesson number; vocab has no
 * lesson data since the v9 source switch, so its new-word pool falls back to
 * jlptLevel === "N2" (this app's core level) instead.
 */
export async function drawTodayPool(counts: PoolCounts, learnedUpTo?: number): Promise<DrawnPools> {
  const usedKeys = new Set<string>();

  const dueRange = IDBKeyRange.upperBound(getStudyDate());
  const dueWords = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "srsDue", dueRange);
  const reviewPicks = sample(dueWords, Math.min(counts.review, dueWords.length));
  for (const w of reviewPicks) usedKeys.add(w.key);

  const weakCandidates = (await getWeakWords()).filter((w) => !usedKeys.has(w.key));
  const weakPicks = sample(weakCandidates, Math.min(counts.weak, weakCandidates.length));
  for (const w of weakPicks) usedKeys.add(w.key);

  const allWordStates = await dbGetAll<WordState>(STORE_WORD_STATE);
  const knownKeys = new Set(allWordStates.map((w) => w.key));
  const store = getStoreSync();

  const newGrammarCandidates: DrawnWord[] = store.grammar
    .filter((g) => !knownKeys.has(makeKey("grammar", g.id)))
    .filter((g) => {
      if (learnedUpTo == null) return true;
      const lessonNum = grammarLessonNumber(g);
      return lessonNum == null || lessonNum <= learnedUpTo;
    })
    .map((g) => ({ kind: "grammar", id: g.id }));

  const newVocabCandidates: DrawnWord[] = store.vocab
    .filter((v) => v.jlptLevel === "N2")
    .filter((v) => !knownKeys.has(makeKey("vocab", v.id)))
    .map((v) => ({ kind: "vocab", id: v.id }));

  const newCandidates = [...newGrammarCandidates, ...newVocabCandidates].filter(
    (c) => !usedKeys.has(makeKey(c.kind, c.id)),
  );
  const newPicks = sample(newCandidates, Math.min(counts.new, newCandidates.length));

  return {
    review: reviewPicks.map((w) => ({ kind: w.kind, id: w.id })),
    weak: weakPicks.map((w) => ({ kind: w.kind, id: w.id })),
    new: newPicks,
  };
}
