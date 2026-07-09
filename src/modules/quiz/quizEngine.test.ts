import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizQuestion } from "../../data/schema.ts";
import type { QuizState } from "./quizEngine.ts";
import { _resetWrongAnswersForTest, getWrongAnswerRecord } from "./quizWrongAnswerStore.ts";

const quiz: QuizQuestion[] = Array.from({ length: 5 }, (_, i) => ({
  id: `q-${i}`,
  category: "grammar" as const,
  jlptLevel: "N2" as const,
  source: "テスト",
  question: `問題${i}（　　）`,
  options: ["A", "B", "C", "D"],
  answer: i % 4,
  explanation: `解説${i}`,
}));

vi.mock("../../data/store.ts", () => ({
  getStoreSync: () => ({ quiz, grammar: [], vocab: [], grammarById: new Map(), vocabById: new Map() }),
}));

const { QuizEngine } = await import("./quizEngine.ts");

describe("QuizEngine", () => {
  beforeEach(() => _resetWrongAnswersForTest());

  it("start() draws the requested number of questions and enters playing phase", () => {
    const engine = new QuizEngine();
    engine.start(3);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    expect(latest!.phase).toBe("playing");
    expect(latest!.questions).toHaveLength(3);
    expect(latest!.currentIndex).toBe(0);
    expect(latest!.pendingIndex).toBeNull();
    expect(latest!.confirmedIndex).toBeNull();
  });

  it("gracefully caps the draw when the pool is smaller than requested", () => {
    const engine = new QuizEngine();
    engine.start(20);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    expect(latest!.questions).toHaveLength(5);
  });

  it("pickOption() sets a tentative pick without grading it yet", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];

    engine.pickOption(question.answer);
    expect(latest!.pendingIndex).toBe(question.answer);
    expect(latest!.confirmedIndex).toBeNull();
    expect(latest!.answers).toEqual([]);

    // Not confirmed yet - free to change your mind and pick a different option.
    const otherIndex = (question.answer + 1) % question.options.length;
    engine.pickOption(otherIndex);
    expect(latest!.pendingIndex).toBe(otherIndex);
  });

  it("confirmAnswer() grades the pending pick, records it, and locks further picks", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];

    engine.pickOption(question.answer);
    engine.confirmAnswer();
    expect(latest!.confirmedIndex).toBe(question.answer);
    expect(latest!.answers).toEqual([
      { questionId: question.id, selectedIndex: question.answer, correct: true },
    ]);

    // Already confirmed - further picks or re-confirms must not change anything.
    const otherIndex = (question.answer + 1) % question.options.length;
    engine.pickOption(otherIndex);
    expect(latest!.pendingIndex).toBe(question.answer);
    engine.confirmAnswer();
    expect(latest!.answers).toHaveLength(1);
  });

  it("confirmAnswer() is a no-op if nothing has been picked yet", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));

    engine.confirmAnswer();
    expect(latest!.confirmedIndex).toBeNull();
    expect(latest!.answers).toEqual([]);
  });

  it("confirmAnswer() records an incorrect pick", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];
    const wrongIndex = (question.answer + 1) % question.options.length;

    engine.pickOption(wrongIndex);
    engine.confirmAnswer();
    expect(latest!.answers[0]).toEqual({
      questionId: question.id,
      selectedIndex: wrongIndex,
      correct: false,
    });
  });

  it("next() only advances once the current question is confirmed, and resets pending/confirmed", () => {
    const engine = new QuizEngine();
    engine.start(2);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));

    engine.pickOption(0);
    engine.next();
    expect(latest!.currentIndex).toBe(0); // blocked - not confirmed yet

    engine.confirmAnswer();
    engine.next();
    expect(latest!.phase).toBe("playing");
    expect(latest!.currentIndex).toBe(1);
    expect(latest!.pendingIndex).toBeNull();
    expect(latest!.confirmedIndex).toBeNull();
  });

  it("next() on the last question finishes the round", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));

    engine.pickOption(0);
    engine.confirmAnswer();
    engine.next();
    expect(latest!.phase).toBe("finished");
  });

  it("confirmAnswer() logs a wrong pick to the persistent wrong-answer history", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];
    const wrongIndex = (question.answer + 1) % question.options.length;

    engine.pickOption(wrongIndex);
    engine.confirmAnswer();
    expect(getWrongAnswerRecord(question.id)?.wrongCount).toBe(1);
  });

  it("confirmAnswer() does not log a correct pick to the wrong-answer history", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];

    engine.pickOption(question.answer);
    engine.confirmAnswer();
    expect(getWrongAnswerRecord(question.id)).toBeUndefined();
  });
});
