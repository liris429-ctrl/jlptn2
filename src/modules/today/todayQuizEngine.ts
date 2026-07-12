import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { sample, shuffle } from "../game/shuffle.ts";
// Vite bundles this at build time (resolveJsonModule) - not part of the
// grammar/vocab/quiz data store (data/store.ts), which only ever fetches
// public/data/*.json at runtime; data-source/ is never served to the
// browser. Cast through unknown: the JSON's inferred literal type doesn't
// line up with ConfusableEntry's hand-written shape (e.g. the unrelated
// `_meta` key), and this is read-only reference data, not re-validated here.
import confusableDataRaw from "../../../data-source/enrichment/confusable.json";
import {
  daysUntil,
  drawExtraRoundPool,
  drawTodayPool,
  getMeta,
  getStudyDate,
  getTodayFirstRoundResult,
  getTodayWrongWords,
  markWordsServedToday,
  recordAnswer,
  recordFirstRoundResult,
  setMeta,
  type DrawnWord,
} from "./srsStore.ts";

/** One-shot signal for todayView.ts's confetti burst: set when round 1
 * finishes (on /today/quiz), consumed the next time /today mounts and
 * renders the freshly-updated "已完成" receipt. In-memory only (not
 * persisted) - this is a hash-router SPA so it survives the navigation from
 * /today/quiz back to /today without a hard reload, but a real page reload
 * legitimately loses the "just happened" context, which is correct: nobody
 * expects a repeat celebration after refreshing the page. */
let pendingCelebration = false;

export function consumePendingCelebration(): boolean {
  const value = pendingCelebration;
  pendingCelebration = false;
  return value;
}

const QUESTION_COUNT = 10;
const MIN_GRAMMAR_QUESTIONS = 2;
const AUTO_ADVANCE_MS = 600;

type PhaseKey = "explore" | "review" | "sprint";

interface PhaseInfo {
  poolCounts: { review: number; weak: number; new: number };
}

const PHASES: Record<PhaseKey, PhaseInfo> = {
  explore: { poolCounts: { review: 5, weak: 2, new: 3 } },
  review: { poolCounts: { review: 5, weak: 4, new: 1 } },
  sprint: { poolCounts: { review: 4, weak: 6, new: 0 } },
};

/** Mirrors todayView.ts's phaseForDays - kept independent (not imported from
 * there) since the view module isn't a dependency-safe import target for a
 * pure-logic engine, and the mapping itself is a two-line lookup table. */
function phaseForDays(days: number | null): PhaseInfo {
  if (days == null || days > 90) return PHASES.explore;
  if (days > 30) return PHASES.review;
  return PHASES.sprint;
}

export interface QuestionOption {
  text: string;
  /** The word/pattern this meaning actually belongs to - itself for the
   * correct option, the distractor's own word/pattern otherwise. Lets the
   * post-answer feedback line name which real word a wrong pick's meaning
   * came from ("你選的是 {干擾詞} 的語意"). */
  sourceLabel: string;
}

export interface TodayQuestion {
  kind: FavoriteKind;
  id: string;
  stem: string;
  correctLabel: string;
  options: QuestionOption[];
  answerIndex: number;
}

export type TodayQuizPhase = "playing" | "finished";

/** "main" = the fixed SRS-ratio "今日十問" (once/day, drives streak + the
 * celebratory finished screen); "extra" = any 續攤 round (wrong-priority +
 * weak-fill or an exact wrong-only retry) - never touches the daily
 * completion flag, gets the deliberately-subdued finished screen. */
export type TodayRoundKind = "main" | "extra";

export interface TodayAnswerRecord {
  kind: FavoriteKind;
  id: string;
  correct: boolean;
  correctLabel: string;
  correctText: string;
  chosenLabel: string;
}

export interface TodayQuizState {
  phase: TodayQuizPhase;
  questions: TodayQuestion[];
  currentIndex: number;
  /** Immediately graded on pick - the spec has no separate confirm step here
   * (unlike the older 實戰考題 quizEngine.ts), so this being non-null means
   * "already answered", not "tentatively picked". */
  selectedIndex: number | null;
  answers: TodayAnswerRecord[];
  roundKind: TodayRoundKind;
}

type Listener = (state: TodayQuizState) => void;

interface RoundSnapshot {
  date: string;
  roundKind: TodayRoundKind;
  questions: TodayQuestion[];
  /** currentIndex is deliberately NOT stored: it's derivable as
   * answers.length, and trusting a separately-persisted copy risks it
   * disagreeing with answers (e.g. a snapshot taken mid-selectOption(),
   * after the answer was pushed but before next() advances currentIndex) -
   * that mismatch once caused resume to re-show an already-answered
   * question as fresh, double-recording it. */
  answers: TodayAnswerRecord[];
}

const ROUND_SNAPSHOT_META_KEY = "todayRoundSnapshot";

/** Home page ("進行中" main-CTA state) reads just this summary - kept here
 * (not in srsStore.ts) so the full RoundSnapshot shape stays this module's
 * own concern; todayView.ts never needs to know what a snapshot looks like.
 * Only "main" snapshots qualify: an abandoned 續攤 round or 昨夜複習 session
 * (both roundKind "extra", and 昨夜複習 specifically has no 10-question cap -
 * see startWithWords()) would otherwise hijack the home page's fixed-10
 * "今日學習任務" tile with a leftover total that was never 10 to begin with.
 * Those still resume correctly if the user navigates straight back into
 * /today/quiz (see start()) - only their surfacing on the home card is
 * restricted to the main round. */
export async function getInProgressRoundSummary(): Promise<{ currentIndex: number; total: number } | null> {
  const snapshot = await getMeta<RoundSnapshot>(ROUND_SNAPSHOT_META_KEY);
  if (snapshot == null || snapshot.date !== getStudyDate() || snapshot.questions.length === 0) return null;
  if (snapshot.roundKind !== "main") return null;
  if (snapshot.answers.length >= snapshot.questions.length) return null;
  return { currentIndex: snapshot.answers.length, total: snapshot.questions.length };
}

/** Home page's "已完成" receipt reads this for its own continue button's
 * label - the same composition a fresh start()'s cold-start branch would
 * draw (today's still-wrong words first, weak-pool padded up to
 * QUESTION_COUNT), so the button never promises a bigger number than what's
 * actually left. */
export async function previewFreshContinueCount(): Promise<number> {
  return (await drawExtraRoundPool(await getTodayWrongWords(), QUESTION_COUNT)).length;
}

function buildVocabQuestion(entry: VocabEntry, allVocab: VocabEntry[]): TodayQuestion {
  const antonymKanjis = new Set(
    (entry.relatedWords ?? []).filter((w) => w.relation === "antonym").map((w) => w.kanji),
  );
  const antonymEntries = allVocab.filter((v) => antonymKanjis.has(v.kanji) && v.meaning !== entry.meaning);
  const antonymIds = new Set(antonymEntries.map((v) => v.id));
  const fallbackPool = allVocab.filter(
    (v) => v.id !== entry.id && v.partOfSpeech === entry.partOfSpeech && v.meaning !== entry.meaning && !antonymIds.has(v.id),
  );

  const distractorEntries = sample(antonymEntries, Math.min(3, antonymEntries.length));
  if (distractorEntries.length < 3) {
    distractorEntries.push(...sample(fallbackPool, 3 - distractorEntries.length));
  }

  const options = shuffle([
    { text: entry.meaning, sourceLabel: entry.kanji },
    ...distractorEntries.map((d) => ({ text: d.meaning, sourceLabel: d.kanji })),
  ]);
  const answerIndex = options.findIndex((o) => o.sourceLabel === entry.kanji);
  return { kind: "vocab", id: entry.id, stem: entry.kanji, correctLabel: entry.kanji, options, answerIndex };
}

interface ConfusableItem {
  id: string;
  _filtered?: boolean;
}

interface ConfusableEntry {
  confusable?: ConfusableItem[];
}

const confusableData = confusableDataRaw as unknown as Record<string, ConfusableEntry>;

const GRAMMAR_DISTRACTOR_TARGET = 3;

/**
 * Three-layer distractor selection, most-targeted first:
 *   1. confusable.json's curated near-miss pairs for this exact id - skips
 *      `_filtered:true` entries and any id not found in `allGrammar` by
 *      exact string match (never substring/fuzzy: つつ/つつも/つつある are
 *      three unrelated ids, see confusable-README.md's id de-dup warning).
 *      Membership is checked against the live-loaded `allGrammar`, not a
 *      separate whitelist file - the README itself says to derive the
 *      whitelist from the actual build output, not trust a hand-maintained
 *      copy.
 *   2. Same 課次 (`lesson`) as a fallback for entries confusable.json has
 *      little or no curated data for (13 ids in the source only have 1
 *      curated distractor - README calls this out as needing a fallback).
 *   3. The prior fully-random pool, only for whatever's still missing.
 * Each layer excludes the entry itself, anything already picked by an
 * earlier layer, and any candidate whose meaning happens to coincide with
 * the correct answer's.
 */
function pickGrammarDistractors(entry: GrammarEntry, allGrammar: GrammarEntry[]): GrammarEntry[] {
  const byId = new Map(allGrammar.map((g) => [g.id, g]));
  const picked: GrammarEntry[] = [];
  const pickedIds = new Set<string>([entry.id]);

  const confusableItems = confusableData[entry.id]?.confusable ?? [];
  for (const item of confusableItems) {
    if (picked.length >= GRAMMAR_DISTRACTOR_TARGET) break;
    if (item._filtered) continue;
    if (pickedIds.has(item.id)) continue;
    const candidate = byId.get(item.id);
    if (!candidate || candidate.meaning === entry.meaning) continue;
    picked.push(candidate);
    pickedIds.add(candidate.id);
  }

  if (picked.length < GRAMMAR_DISTRACTOR_TARGET && entry.lesson) {
    const sameLesson = allGrammar.filter(
      (g) => g.lesson === entry.lesson && !pickedIds.has(g.id) && g.meaning !== entry.meaning,
    );
    const needed = GRAMMAR_DISTRACTOR_TARGET - picked.length;
    for (const g of sample(sameLesson, Math.min(needed, sameLesson.length))) {
      picked.push(g);
      pickedIds.add(g.id);
    }
  }

  if (picked.length < GRAMMAR_DISTRACTOR_TARGET) {
    const fallbackPool = allGrammar.filter((g) => !pickedIds.has(g.id) && g.meaning !== entry.meaning);
    const needed = GRAMMAR_DISTRACTOR_TARGET - picked.length;
    picked.push(...sample(fallbackPool, Math.min(needed, fallbackPool.length)));
  }

  return picked;
}

/**
 * Degrades straight to "grammar explanation -> pick the meaning" (per spec
 * 3.2's explicit fallback) rather than attempting to blank out the pattern
 * inside a real example sentence: examples use the pattern's conjugated,
 * in-context form, not the abstract pattern notation, so there's no reliable
 * substring match to replace with "___" without sentence-level NLP.
 */
function buildGrammarQuestion(entry: GrammarEntry, allGrammar: GrammarEntry[]): TodayQuestion {
  const distractorEntries = pickGrammarDistractors(entry, allGrammar);
  const options = shuffle([
    { text: entry.meaning, sourceLabel: entry.pattern },
    ...distractorEntries.map((d) => ({ text: d.meaning, sourceLabel: d.pattern })),
  ]);
  const answerIndex = options.findIndex((o) => o.sourceLabel === entry.pattern);
  return { kind: "grammar", id: entry.id, stem: entry.pattern, correctLabel: entry.pattern, options, answerIndex };
}

function buildQuestion(word: DrawnWord): TodayQuestion | null {
  const store = getStoreSync();
  if (word.kind === "vocab") {
    const entry = store.vocabById.get(word.id);
    return entry ? buildVocabQuestion(entry, store.vocab) : null;
  }
  const entry = store.grammarById.get(word.id);
  return entry ? buildGrammarQuestion(entry, store.grammar) : null;
}

function wordKey(w: DrawnWord): string {
  return `${w.kind}:${w.id}`;
}

/** Tops up the grammar count to MIN_GRAMMAR_QUESTIONS by swapping in extra,
 * unused grammar entries in place of vocab picks - never drops below what's
 * actually available. */
function enforceGrammarMinimum(drawn: DrawnWord[]): DrawnWord[] {
  const grammarCount = drawn.filter((w) => w.kind === "grammar").length;
  const needed = MIN_GRAMMAR_QUESTIONS - grammarCount;
  if (needed <= 0 || drawn.length === 0) return drawn;

  const store = getStoreSync();
  const used = new Set(drawn.map(wordKey));
  const extraPool: DrawnWord[] = store.grammar
    .filter((g) => !used.has(`grammar:${g.id}`))
    .map((g) => ({ kind: "grammar" as const, id: g.id }));
  const extras = sample(extraPool, Math.min(needed, extraPool.length));
  if (extras.length === 0) return drawn;

  const vocabIndices = drawn.map((w, i) => (w.kind === "vocab" ? i : -1)).filter((i) => i >= 0);
  const removeSet = new Set(vocabIndices.slice(-extras.length));
  return [...drawn.filter((_, i) => !removeSet.has(i)), ...extras];
}

/**
 * Untimed except for the spec's own 600ms auto-advance after grading - no
 * setup phase (fixed 10 questions, drawn as soon as start() is called from
 * the today page's main CTA) and no navigation guard in the view (leaving
 * mid-round is fine: every answer is already durably recorded via
 * recordAnswer as it happens, so only the current round position is lost -
 * see persistSnapshot()/clearSnapshot() for what IS carried across a leave).
 */
export class TodayQuizEngine {
  private state: TodayQuizState = {
    phase: "playing",
    questions: [],
    currentIndex: 0,
    selectedIndex: null,
    answers: [],
    roundKind: "main",
  };
  private listeners = new Set<Listener>();
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private clearTimer(): void {
    if (this.advanceTimer != null) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  /** Carries an in-progress round across a full page leave-and-return (the
   * "進行中" main-CTA state on the home page, and resuming into the exact
   * same question on re-entry) - only meaningful while phase is "playing";
   * cleared once the round finishes since there's nothing left to resume. */
  private async persistSnapshot(): Promise<void> {
    const snapshot: RoundSnapshot = {
      date: getStudyDate(),
      roundKind: this.state.roundKind,
      questions: this.state.questions,
      answers: this.state.answers,
    };
    await setMeta(ROUND_SNAPSHOT_META_KEY, snapshot);
  }

  private async clearSnapshot(): Promise<void> {
    await setMeta(ROUND_SNAPSHOT_META_KEY, null);
  }

  /**
   * Entry point for the home page's main CTA. Resumes an in-progress MAIN
   * round from earlier today first (if any); otherwise draws round 1
   * ("今日十問", the fixed SRS-ratio round) if it hasn't run yet today, or
   * transparently falls through to a weak-fill-only 續攤 round if it has -
   * this covers a fresh engine instance being started (e.g. via direct
   * navigation or the "已完成" card's "再練10題" link) after round 1 is
   * already done, without the view needing to know which mode to request.
   */
  async start(): Promise<void> {
    const today = getStudyDate();
    const snapshot = await getMeta<RoundSnapshot>(ROUND_SNAPSHOT_META_KEY);
    // currentIndex is derived from answers.length (see RoundSnapshot), not
    // trusted as a separately-stored value - this is what resuming exactly
    // at "the next unanswered question" (never re-asking one already
    // recorded) actually depends on. roundKind === "main" is load-bearing:
    // without it, an abandoned 續攤 round or 昨夜複習 session (roundKind
    // "extra", the latter with no 10-question cap - see startWithWords())
    // left over from earlier today gets silently resumed here instead of a
    // fresh main round starting - the "開始" button would hand back someone
    // else's half-finished 20-question session, and finishing it never
    // calls recordFirstRoundResult (only "main" rounds do), so the home
    // card still shows "開始・還有10題" afterward as if nothing happened.
    if (
      snapshot != null &&
      snapshot.date === today &&
      snapshot.roundKind === "main" &&
      snapshot.questions.length > 0 &&
      snapshot.answers.length < snapshot.questions.length
    ) {
      this.state = {
        phase: "playing",
        questions: snapshot.questions,
        currentIndex: snapshot.answers.length,
        selectedIndex: null,
        answers: snapshot.answers,
        roundKind: snapshot.roundKind,
      };
      this.emit();
      return;
    }

    const firstRoundDone = (await getTodayFirstRoundResult()) != null;
    if (!firstRoundDone) {
      await this.startMainRound();
    } else {
      // A cold start (no in-memory answers to ask wrongAsDrawnWords() for)
      // still prioritizes whatever's currently wrong today - see
      // getTodayWrongWords() for why this can't just reuse getWeakWords().
      await this.startExtraRound(await getTodayWrongWords());
    }
  }

  private async startMainRound(): Promise<void> {
    const today = getStudyDate();
    const [examDate, learnedUpTo] = await Promise.all([
      getMeta<string>("examDate"),
      getMeta<number>("learnedUpTo"),
    ]);
    const days = examDate ? daysUntil(examDate, today) : null;
    const phase = phaseForDays(days);

    const pools = await drawTodayPool(phase.poolCounts, learnedUpTo);
    let drawn = [...pools.review, ...pools.weak, ...pools.new];
    drawn = enforceGrammarMinimum(drawn);
    drawn = shuffle(drawn).slice(0, QUESTION_COUNT);
    await markWordsServedToday(drawn);

    const questions = drawn.map(buildQuestion).filter((q): q is TodayQuestion => q !== null);
    this.loadQuestions(questions, "main");
  }

  /** 續攤: `priorWrong` first, padded with weak-pool fill up to
   * QUESTION_COUNT, no new words, never touches the daily-completion flag.
   * Naturally comes up with fewer questions (down to zero) once the wrong
   * list and weak pool both run dry - "池子枯竭時自然收尾". */
  private async startExtraRound(priorWrong: DrawnWord[]): Promise<void> {
    const composed = await drawExtraRoundPool(priorWrong, QUESTION_COUNT);
    await markWordsServedToday(composed);
    const questions = composed.map(buildQuestion).filter((q): q is TodayQuestion => q !== null);
    this.loadQuestions(questions, "extra");
  }

  /** Read-only preview of what continueRound() would draw right now (same
   * composition, no side effects) - lets the finished screen show an honest
   * "再練 N 個" count, or the exhausted message, before the user commits. */
  async previewContinueCount(): Promise<number> {
    const priorWrong = this.wrongAsDrawnWords();
    const composed = await drawExtraRoundPool(priorWrong, QUESTION_COUNT);
    return composed.length;
  }

  /** Starts the next 續攤 round from this round's own wrong answers (if any)
   * plus weak-pool fill - the general "再練" action on any finished screen
   * except round 1's own exact-wrong-only retry (see retryWrongOnly()). */
  async continueRound(): Promise<void> {
    await this.startExtraRound(this.wrongAsDrawnWords());
  }

  private wrongAsDrawnWords(): DrawnWord[] {
    return this.state.answers.filter((a) => !a.correct).map((a) => ({ kind: a.kind, id: a.id }));
  }

  /** Loads a fixed set of questions directly - used by retryWrongOnly(),
   * startWithWords(), and tests. */
  private loadQuestions(questions: TodayQuestion[], roundKind: TodayRoundKind = "extra"): void {
    this.clearTimer();
    this.state = {
      phase: questions.length > 0 ? "playing" : "finished",
      questions,
      currentIndex: 0,
      selectedIndex: null,
      answers: [],
      roundKind,
    };
    this.emit();
    void (this.state.phase === "playing" ? this.persistSnapshot() : this.clearSnapshot());
  }

  /**
   * Quizzes exactly this word list, in shuffled order - no pool-ratio rules,
   * no grammar minimum, no 10-question cap. Used by milestone 3's 昨夜複習
   * mini-quiz ("只考那批,寫入 source=quiz"), which the view still records
   * through the normal recordAnswer(..., "quiz") path in selectOption().
   * Not round 1 and not a 續攤 (it's a separate milestone-3 feature), but
   * "extra" is the correct roundKind for it either way: it should never get
   * the round-1-only celebratory finished screen.
   */
  startWithWords(words: DrawnWord[]): void {
    const questions = shuffle(words).map(buildQuestion).filter((q): q is TodayQuestion => q !== null);
    this.loadQuestions(questions, "extra");
  }

  /** Grades immediately (no separate confirm step), records the answer, and
   * auto-advances after 600ms. */
  selectOption(index: number): void {
    if (this.state.phase !== "playing" || this.state.selectedIndex !== null) return;
    const question = this.state.questions[this.state.currentIndex]!;
    const correct = index === question.answerIndex;
    void recordAnswer(question.kind, question.id, correct, "quiz");

    const record: TodayAnswerRecord = {
      kind: question.kind,
      id: question.id,
      correct,
      correctLabel: question.correctLabel,
      correctText: question.options[question.answerIndex]!.text,
      chosenLabel: question.options[index]!.sourceLabel,
    };
    this.state = { ...this.state, selectedIndex: index, answers: [...this.state.answers, record] };
    this.emit();
    void this.persistSnapshot();

    this.advanceTimer = setTimeout(() => this.next(), AUTO_ADVANCE_MS);
  }

  next(): void {
    this.clearTimer();
    if (this.state.phase !== "playing") return;
    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.questions.length) {
      this.state = { ...this.state, phase: "finished" };
      if (this.state.roundKind === "main") {
        const correct = this.state.answers.filter((a) => a.correct).length;
        void recordFirstRoundResult(correct, this.state.answers.length);
        pendingCelebration = true;
      }
      void this.clearSnapshot();
    } else {
      this.state = { ...this.state, currentIndex: nextIndex, selectedIndex: null };
      void this.persistSnapshot();
    }
    this.emit();
  }

  /** Re-tests only this round's wrong questions, in their original form, no
   * weak-pool padding - the round-1-finished screen's "再練這N個錯題" action
   * specifically (see continueRound() for the padded, general 續攤 case).
   * Still marked "extra": never re-triggers the round-1 celebratory screen. */
  retryWrongOnly(): void {
    const wrongIndices = this.state.answers.map((a, i) => (a.correct ? -1 : i)).filter((i) => i >= 0);
    const wrongQuestions = wrongIndices.map((i) => this.state.questions[i]!);
    void markWordsServedToday(wrongQuestions.map((q) => ({ kind: q.kind, id: q.id })));
    this.loadQuestions(wrongQuestions, "extra");
  }

  stop(): void {
    this.clearTimer();
  }
}
