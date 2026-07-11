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
  /** Snapshot of round 1's OWN score (the fixed SRS-ratio "今日十問"), set
   * once when that specific round finishes - distinct from the running
   * answered/correct totals above, which also accumulate every 續攤 round
   * and anki/lookup event that same day. Optional because records written
   * before this field existed won't have it - treat missing as null, not as
   * "round 1 done with a blank score". */
  firstRound?: { correct: number; total: number } | null;
}

const RECENT_LIMIT = 10;
const SRS_LADDER = [1, 3, 7, 14, 30];
const WEAK_MASTERY_CEILING = 0.6;
const WEAK_MIN_SEEN = 3;
const RECENT_WRONG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_SUMMARY_MIN_ANSWERED = 20;
const WEEK_SUMMARY_DIFF_THRESHOLD_PCT = 5;
const DAILY_GRAMMAR_WEAK_POOL_SIZE = 10;

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

/**
 * How many of this word's answers were wrong within the last 7 days, counted
 * straight from `recent` (which holds ts per event) - the single source of
 * truth for both "does this word make the recent-wrong list" and "what
 * number does its ×N badge show" (todayView.ts), so the two can never drift
 * out of sync with each other again.
 */
export function recentWrongCount(w: WordState, now: number = Date.now()): number {
  return w.recent.filter((e) => e.r === 0 && now - e.ts <= RECENT_WRONG_WINDOW_MS).length;
}

/**
 * Ranked by recentWrongCount desc then lastWrongAt desc. Eligibility is
 * recentWrongCount(w) >= 1, not just "lastWrongAt is within 7 days" - a word
 * whose only recent-window wrong got pushed out of `recent` by 10+ later
 * correct answers has a stale-but-in-window lastWrongAt and must NOT still
 * count as "recently wrong". The lastWrongAt index range query below is only
 * a safe pre-filter to avoid a full-table scan (lastWrongAt, the timestamp
 * of the single most recent wrong ever, is always >= any recentWrongCount-
 * qualifying event's timestamp - so it can never exclude a true positive,
 * only include some now-stale rows that get filtered out next).
 */
export async function getRecentWrongEntries(limit = 5): Promise<WordState[]> {
  const now = Date.now();
  const range = IDBKeyRange.lowerBound(now - RECENT_WRONG_WINDOW_MS);
  const candidates = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "lastWrongAt", range);
  return candidates
    .map((w) => ({ w, count: recentWrongCount(w, now) }))
    .filter(({ count }) => count >= 1)
    .sort((a, b) => b.count - a.count || (b.w.lastWrongAt ?? 0) - (a.w.lastWrongAt ?? 0))
    .slice(0, limit)
    .map(({ w }) => w);
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

/** Writes round 1's own score once it finishes - see DailyStats.firstRound. */
export async function recordFirstRoundResult(correct: number, total: number, now: number = Date.now()): Promise<void> {
  const today = getStudyDate(now);
  const db = await openDb();
  const tx = db.transaction(STORE_DAILY_STATS, "readwrite");
  const store = tx.objectStore(STORE_DAILY_STATS);
  const existing = await new Promise<DailyStats | undefined>((resolve, reject) => {
    const req = store.get(today);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const stats: DailyStats = existing ?? { date: today, answered: 0, correct: 0, games: {} };
  stats.firstRound = { correct, total };
  store.put(stats);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  emit();
}

/** null when round 1 ("今日十問") hasn't finished yet today. */
export async function getTodayFirstRoundResult(
  now: number = Date.now(),
): Promise<{ correct: number; total: number } | null> {
  const stats = await dbGet<DailyStats>(STORE_DAILY_STATS, getStudyDate(now));
  return stats?.firstRound ?? null;
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

/** Vocab/grammar entries with no wordState record at all, scoped to
 * `learnedUpTo` (grammar lesson number) - vocab has no lesson data since the
 * v9 source switch, so its new-word pool falls back to jlptLevel === "N2"
 * (this app's core level) instead. Shared by drawTodayPool (sampling) and
 * getNewCount (just the size) so the scoping rule only lives in one place. */
async function getNewCandidates(learnedUpTo?: number): Promise<DrawnWord[]> {
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

  return [...newGrammarCandidates, ...newVocabCandidates];
}

export async function getNewCount(learnedUpTo?: number): Promise<number> {
  return (await getNewCandidates(learnedUpTo)).length;
}

interface ServedTodayRecord {
  date: string;
  ids: string[];
}

const SERVED_TODAY_META_KEY = "servedTodayIds";

/** Reads back today's served-word record, embedding its own `date` so a
 * leftover record from a prior day is recognized as stale and treated as
 * empty (rather than trusting the meta key's mere presence) - self-resetting
 * on every read, no separate "clear yesterday's record" step needed. */
async function readServedTodayIds(now: number = Date.now()): Promise<Set<string>> {
  const rec = await getMeta<ServedTodayRecord>(SERVED_TODAY_META_KEY);
  if (rec == null || rec.date !== getStudyDate(now)) return new Set();
  return new Set(rec.ids);
}

/** Adds to today's served-word record - words already asked today (in round 1
 * or any 續攤 round) so a later round doesn't repeat them. */
export async function markWordsServedToday(words: DrawnWord[], now: number = Date.now()): Promise<void> {
  if (words.length === 0) return;
  const current = await readServedTodayIds(now);
  for (const w of words) current.add(makeKey(w.kind, w.id));
  await setMeta(SERVED_TODAY_META_KEY, { date: getStudyDate(now), ids: [...current] } satisfies ServedTodayRecord);
}

/**
 * Draws up to `counts.review`/`counts.weak`/`counts.new` candidates from three
 * disjoint pools (a word picked for one pool is excluded from the others, so
 * the same word never appears twice - "同一詞不會重複"), also excluding
 * anything already served today (e.g. an abandoned-and-restarted round 1).
 * If a pool comes up short of its own target, the shortfall is topped up
 * from the other pools' leftover (unpicked) candidates, tried in review ->
 * weak -> new priority order (spec 3.1's "缺額依複習→弱點→新詞順序遞補") -
 * so the round still reaches the full requested total whenever enough words
 * exist *somewhere*, not just in whichever pool happened to be data-poor
 * this phase.
 */
export async function drawTodayPool(counts: PoolCounts, learnedUpTo?: number): Promise<DrawnPools> {
  const usedKeys = await readServedTodayIds();

  const dueRange = IDBKeyRange.upperBound(getStudyDate());
  const dueWords = await dbGetAllByIndexRange<WordState>(STORE_WORD_STATE, "srsDue", dueRange);
  const dueCandidates = dueWords.filter((w) => !usedKeys.has(w.key));
  const reviewPicks = sample(dueCandidates, Math.min(counts.review, dueCandidates.length));
  for (const w of reviewPicks) usedKeys.add(w.key);

  const weakCandidates = (await getWeakWords()).filter((w) => !usedKeys.has(w.key));
  const weakPicks = sample(weakCandidates, Math.min(counts.weak, weakCandidates.length));
  for (const w of weakPicks) usedKeys.add(w.key);

  const newCandidates = (await getNewCandidates(learnedUpTo)).filter(
    (c) => !usedKeys.has(makeKey(c.kind, c.id)),
  );
  const newPicks = sample(newCandidates, Math.min(counts.new, newCandidates.length));
  for (const w of newPicks) usedKeys.add(makeKey(w.kind, w.id));

  let shortfall = counts.review + counts.weak + counts.new - (reviewPicks.length + weakPicks.length + newPicks.length);

  if (shortfall > 0) {
    const leftover = dueWords.filter((w) => !usedKeys.has(w.key));
    const topUp = sample(leftover, Math.min(shortfall, leftover.length));
    for (const w of topUp) usedKeys.add(w.key);
    reviewPicks.push(...topUp);
    shortfall -= topUp.length;
  }
  if (shortfall > 0) {
    const leftover = weakCandidates.filter((w) => !usedKeys.has(w.key));
    const topUp = sample(leftover, Math.min(shortfall, leftover.length));
    for (const w of topUp) usedKeys.add(w.key);
    weakPicks.push(...topUp);
    shortfall -= topUp.length;
  }
  if (shortfall > 0) {
    const leftover = newCandidates.filter((c) => !usedKeys.has(makeKey(c.kind, c.id)));
    const topUp = sample(leftover, Math.min(shortfall, leftover.length));
    newPicks.push(...topUp);
  }

  return {
    review: reviewPicks.map((w) => ({ kind: w.kind, id: w.id })),
    weak: weakPicks.map((w) => ({ kind: w.kind, id: w.id })),
    new: newPicks,
  };
}

/**
 * Every word whose most recent attempt *today* was wrong - the cold-start
 * equivalent of an in-memory round's own wrongAsDrawnWords(), for callers
 * with no just-finished engine instance to ask (the home page's continue
 * button is a fresh navigation, not a same-session retry). Deliberately not
 * gated by WEAK_MIN_SEEN like getWeakWords(): a word missed for the first or
 * second time ever is exactly the kind of mistake this round exists to
 * resurface today, not just once it's been seen 3+ times. "Most recent
 * today" (not "any event today") so a word that was wrong then corrected
 * later the same day doesn't linger as if still unresolved.
 */
export async function getTodayWrongWords(): Promise<DrawnWord[]> {
  const today = getStudyDate();
  const all = await dbGetAll<WordState>(STORE_WORD_STATE);
  return all
    .filter((w) => {
      const todaysEvents = w.recent.filter((e) => getStudyDate(e.ts) === today);
      const last = todaysEvents[todaysEvents.length - 1];
      return last != null && last.r === 0;
    })
    .map((w) => ({ kind: w.kind, id: w.id }));
}

/**
 * Composes a 續攤 (extra) round: `priorWrong` first (the caller's own
 * just-finished round's wrong answers, when it has any - see
 * getTodayWrongWords() for the cold-start equivalent), padded with
 * weak-pool candidates up to `target` - no new words, and excluding anything
 * already served today (and `priorWrong` itself, so it's never double-
 * counted). Pure/read-only: does not mark the result as served - the caller
 * does that only once it actually commits to using the drawn set (see
 * todayQuizEngine.ts), so this is also safe to call repeatedly as a preview.
 * Naturally returns fewer than `target` (down to empty) once both the wrong
 * list and the weak pool run dry - "池子枯竭時自然收尾", not an error case.
 */
export async function drawExtraRoundPool(priorWrongIn: DrawnWord[], target: number): Promise<DrawnWord[]> {
  // Clamped defensively: callers like getTodayWrongWords() can return more
  // than target items (several rounds' worth of mistakes in one day), and
  // target is meant to be a real cap on the round size, not just a
  // fill-up-to suggestion.
  const priorWrong = priorWrongIn.slice(0, target);
  const served = await readServedTodayIds();
  const priorKeys = new Set(priorWrong.map((w) => makeKey(w.kind, w.id)));
  const today = getStudyDate();
  const weakCandidates = (await getWeakWords())
    .filter((w) => !priorKeys.has(w.key))
    // A word served today is normally excluded (already asked in an earlier
    // round today - keeps later rounds varied instead of repeating), but not
    // if today's exposure included a wrong answer: re-surfacing a fresh
    // mistake in the same day is the whole point of an SRS "again" queue, so
    // it must stay eligible here rather than vanishing until tomorrow just
    // because it was already served once (e.g. a word missed in round 1
    // must still be able to appear when "再練N個" is pressed from the home
    // page later, not just via the same-session retryWrongOnly() button).
    .filter((w) => !served.has(w.key) || w.recent.some((e) => e.r === 0 && getStudyDate(e.ts) === today))
    .map((w): DrawnWord => ({ kind: w.kind, id: w.id }));
  const needed = Math.max(0, target - priorWrong.length);
  const fill = sample(weakCandidates, Math.min(needed, weakCandidates.length));
  return [...priorWrong, ...fill];
}

/**
 * Words first seen yesterday (milestone 3's "昨夜複習"), excluding ones whose
 * only interaction so far was a passive touchWord() browse (recent.length===0
 * - never an actual quiz/anki event) - the spec's "排除首次事件在低分（含
 * lookup來源）的詞" filter. touchWord() never pushes a `recent` entry, so an
 * empty `recent` array is exactly "looked at but never really tested".
 */
export async function getYesterdayNewWords(): Promise<WordState[]> {
  const yesterday = addDays(getStudyDate(), -1);
  const allWords = await dbGetAll<WordState>(STORE_WORD_STATE);
  // recent.length > 0 alone isn't "tested yesterday" - recent only holds the
  // most recent 10 events ever, with no day filter, so a word first seen
  // yesterday but then heavily re-tested today (enough to push yesterday's
  // own event out of the 10-slot window) would still pass a bare
  // non-empty check even though nothing in `recent` actually happened
  // yesterday anymore. Require at least one surviving event whose own
  // timestamp falls on yesterday's study-date.
  return allWords.filter(
    (w) => getStudyDate(w.firstSeenAt) === yesterday && w.recent.some((e) => getStudyDate(e.ts) === yesterday),
  );
}

function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  let t = (h ^ 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Milestone 3's 每日一文法卡: a deterministic per-day pick (seeded by the
 * study date), locked in and cached in `meta` the first time it's computed
 * for that date. Without this, the pick was recomputed from live data on
 * every call: `untouched.length` (and the tier-2 weak pool) shrinks the
 * moment ANY grammar entry gets touched that day - including the picked
 * entry itself, just from the user reading it - which shifted the seeded
 * index against a now-different-sized pool and silently changed "today's"
 * result mid-day. Caching the resolved id means today's pick is decided once
 * (whenever the user first opens the app that day) and stays that entry no
 * matter what else gets touched afterward - "today's assignment" behaves
 * like a real daily task, not a value that can drift underneath the user.
 *
 * Selection, in three priority tiers:
 *   1. Grammar never touched at all - "每天滴灌一條沒看過的文法" is this
 *      feature's actual purpose, not a fallback, so untouched grammar always
 *      wins while any exists.
 *   2. Once every grammar point has been touched, surface a genuine weak
 *      spot: among entries tested enough times (seen >= 3, same threshold as
 *      getWeakWords) for `mastery` to mean anything, take the
 *      DAILY_GRAMMAR_WEAK_POOL_SIZE lowest-mastery ones and seed-pick one of
 *      those - keeps the "surface a weak spot" intent without pinning every
 *      day to the single worst entry until it happens to improve.
 *   3. Last resort, when everything is touched but nothing has reached
 *      seen >= 3 yet (e.g. right after a fresh start): fall back to raw
 *      lowest mastery across all touched entries, so this still returns a
 *      real pick instead of null.
 */
export async function getDailyGrammarPick(seedDate: string = getStudyDate()): Promise<string | null> {
  const cacheKey = `dailyGrammarPick:${seedDate}`;
  const cached = await getMeta<string | null>(cacheKey);
  if (cached !== undefined) return cached;

  const pick = await computeDailyGrammarPick(seedDate);
  await setMeta(cacheKey, pick);
  return pick;
}

async function computeDailyGrammarPick(seedDate: string): Promise<string | null> {
  const store = getStoreSync();
  if (store.grammar.length === 0) return null;

  const allWords = await dbGetAll<WordState>(STORE_WORD_STATE);
  const grammarStates = new Map(allWords.filter((w) => w.kind === "grammar").map((w) => [w.id, w]));

  const untouched = store.grammar.filter((g) => !grammarStates.has(g.id));
  if (untouched.length > 0) {
    const index = Math.floor(seededRandom(seedDate) * untouched.length);
    return untouched[index]!.id;
  }

  const testedEnough = [...grammarStates.values()].filter((w) => w.seen >= WEAK_MIN_SEEN);
  if (testedEnough.length > 0) {
    const weakestPool = testedEnough
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, DAILY_GRAMMAR_WEAK_POOL_SIZE);
    const index = Math.floor(seededRandom(seedDate) * weakestPool.length);
    return weakestPool[index]!.id;
  }

  const byMasteryAsc = [...grammarStates.values()].sort((a, b) => a.mastery - b.mastery);
  return byMasteryAsc[0]?.id ?? null;
}
