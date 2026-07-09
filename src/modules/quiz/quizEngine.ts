import type { QuizCategory, QuizQuestion } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { sample } from "../game/shuffle.ts";
import { recordWrongAnswer } from "./quizWrongAnswerStore.ts";

export type QuizPhase = "setup" | "playing" | "finished";

export interface QuizAnswerRecord {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
}

export interface QuizState {
  phase: QuizPhase;
  questions: QuizQuestion[];
  currentIndex: number;
  /** Tentative pick for the current question - not graded yet, can still be changed. */
  pendingIndex: number | null;
  /** Set once 確定 is pressed: grading colors, explanation, and the next button all key off this. */
  confirmedIndex: number | null;
  answers: QuizAnswerRecord[];
}

type Listener = (state: QuizState) => void;

/**
 * Untimed, self-paced quiz - no tick interval needed (unlike GameEngine's 連連看
 * round), so this is just plain state transitions with the same pub-sub shape for
 * consistency with the rest of the codebase.
 */
export class QuizEngine {
  private state: QuizState = QuizEngine.initialState();
  private listeners = new Set<Listener>();

  private static initialState(): QuizState {
    return {
      phase: "setup",
      questions: [],
      currentIndex: 0,
      pendingIndex: null,
      confirmedIndex: null,
      answers: [],
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  /** Draws min(count, available) questions for the category - never errors on a small bank. */
  start(count: number, category: QuizCategory = "grammar"): void {
    const pool = getStoreSync().quiz.filter((q) => q.category === category);
    const questions = sample(pool, Math.min(count, pool.length));
    this.state = {
      phase: "playing",
      questions,
      currentIndex: 0,
      pendingIndex: null,
      confirmedIndex: null,
      answers: [],
    };
    this.emit();
  }

  /** A tentative pick - can be changed freely by picking a different option, until confirmAnswer() locks it in. */
  pickOption(index: number): void {
    if (this.state.phase !== "playing" || this.state.confirmedIndex !== null) return;
    this.state = { ...this.state, pendingIndex: index };
    this.emit();
  }

  /** Grades the pending pick and records it - including logging a wrong pick to the persistent history. */
  confirmAnswer(): void {
    if (this.state.phase !== "playing" || this.state.confirmedIndex !== null || this.state.pendingIndex === null) {
      return;
    }
    const question = this.state.questions[this.state.currentIndex]!;
    const index = this.state.pendingIndex;
    const correct = index === question.answer;
    if (!correct) recordWrongAnswer(question.id);
    const record: QuizAnswerRecord = { questionId: question.id, selectedIndex: index, correct };
    this.state = { ...this.state, confirmedIndex: index, answers: [...this.state.answers, record] };
    this.emit();
  }

  /** Back to the setup screen (e.g. "重新測驗") without picking a count yet. */
  reset(): void {
    this.state = QuizEngine.initialState();
    this.emit();
  }

  /** Only advances once the current question has been confirmed. */
  next(): void {
    if (this.state.phase !== "playing" || this.state.confirmedIndex === null) return;
    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.questions.length) {
      this.state = { ...this.state, phase: "finished" };
    } else {
      this.state = { ...this.state, currentIndex: nextIndex, pendingIndex: null, confirmedIndex: null };
    }
    this.emit();
  }

  /** Total questions available for a category, so the setup screen can show a hint. */
  static availableCount(category: QuizCategory = "grammar"): number {
    return getStoreSync().quiz.filter((q) => q.category === category).length;
  }
}
