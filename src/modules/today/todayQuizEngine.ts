import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { sample, shuffle } from "../game/shuffle.ts";
import { daysUntil, drawTodayPool, getMeta, getStudyDate, recordAnswer, type DrawnWord } from "./srsStore.ts";

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
}

type Listener = (state: TodayQuizState) => void;

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

/**
 * Degrades straight to "grammar explanation -> pick the meaning" (per spec
 * 3.2's explicit fallback) rather than attempting to blank out the pattern
 * inside a real example sentence: examples use the pattern's conjugated,
 * in-context form, not the abstract pattern notation, so there's no reliable
 * substring match to replace with "___" without sentence-level NLP.
 */
function buildGrammarQuestion(entry: GrammarEntry, allGrammar: GrammarEntry[]): TodayQuestion {
  const fallbackPool = allGrammar.filter((g) => g.id !== entry.id && g.meaning !== entry.meaning);
  const distractorEntries = sample(fallbackPool, Math.min(3, fallbackPool.length));
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
 * recordAnswer as it happens, so only the current round position is lost).
 */
export class TodayQuizEngine {
  private state: TodayQuizState = { phase: "playing", questions: [], currentIndex: 0, selectedIndex: null, answers: [] };
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

  async start(): Promise<void> {
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

    const questions = drawn.map(buildQuestion).filter((q): q is TodayQuestion => q !== null);

    this.clearTimer();
    this.state = {
      phase: "playing",
      questions,
      currentIndex: 0,
      selectedIndex: null,
      answers: [],
    };
    this.emit();
  }

  /** Loads a fixed set of questions directly - used by retryWrongOnly() and tests. */
  private loadQuestions(questions: TodayQuestion[]): void {
    this.clearTimer();
    this.state = { phase: questions.length > 0 ? "playing" : "finished", questions, currentIndex: 0, selectedIndex: null, answers: [] };
    this.emit();
  }

  /**
   * Quizzes exactly this word list, in shuffled order - no pool-ratio rules,
   * no grammar minimum, no 10-question cap. Used by milestone 3's 昨夜複習
   * mini-quiz ("只考那批,寫入 source=quiz"), which the view still records
   * through the normal recordAnswer(..., "quiz") path in selectOption().
   */
  startWithWords(words: DrawnWord[]): void {
    const questions = shuffle(words).map(buildQuestion).filter((q): q is TodayQuestion => q !== null);
    this.loadQuestions(questions);
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

    this.advanceTimer = setTimeout(() => this.next(), AUTO_ADVANCE_MS);
  }

  next(): void {
    this.clearTimer();
    if (this.state.phase !== "playing") return;
    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.questions.length) {
      this.state = { ...this.state, phase: "finished" };
    } else {
      this.state = { ...this.state, currentIndex: nextIndex, selectedIndex: null };
    }
    this.emit();
  }

  /** Re-tests only this round's wrong questions, in their original form -
   * does not re-apply the pool-ratio rules. */
  retryWrongOnly(): void {
    const wrongIndices = this.state.answers.map((a, i) => (a.correct ? -1 : i)).filter((i) => i >= 0);
    this.loadQuestions(wrongIndices.map((i) => this.state.questions[i]!));
  }

  stop(): void {
    this.clearTimer();
  }
}
