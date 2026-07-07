import { describe, expect, it, vi } from "vitest";
import type { QuizQuestion } from "../../data/schema.ts";
import type { QuizState } from "./quizEngine.ts";

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
  it("start() draws the requested number of questions and enters playing phase", () => {
    const engine = new QuizEngine();
    engine.start(3);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    expect(latest!.phase).toBe("playing");
    expect(latest!.questions).toHaveLength(3);
    expect(latest!.currentIndex).toBe(0);
    expect(latest!.selectedIndex).toBeNull();
  });

  it("gracefully caps the draw when the pool is smaller than requested", () => {
    const engine = new QuizEngine();
    engine.start(20);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    expect(latest!.questions).toHaveLength(5);
  });

  it("selectAnswer() records correctness and locks the pick", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];

    engine.selectAnswer(question.answer);
    expect(latest!.selectedIndex).toBe(question.answer);
    expect(latest!.answers).toEqual([
      { questionId: question.id, selectedIndex: question.answer, correct: true },
    ]);

    // Already answered - a second call must not overwrite the recorded answer.
    const wrongIndex = (question.answer + 1) % question.options.length;
    engine.selectAnswer(wrongIndex);
    expect(latest!.selectedIndex).toBe(question.answer);
    expect(latest!.answers).toHaveLength(1);
  });

  it("selectAnswer() records an incorrect pick", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));
    const question = latest!.questions[0];
    const wrongIndex = (question.answer + 1) % question.options.length;

    engine.selectAnswer(wrongIndex);
    expect(latest!.answers[0]).toEqual({
      questionId: question.id,
      selectedIndex: wrongIndex,
      correct: false,
    });
  });

  it("next() advances to the next question and resets selectedIndex", () => {
    const engine = new QuizEngine();
    engine.start(2);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));

    engine.selectAnswer(0);
    engine.next();
    expect(latest!.phase).toBe("playing");
    expect(latest!.currentIndex).toBe(1);
    expect(latest!.selectedIndex).toBeNull();
  });

  it("next() on the last question finishes the round", () => {
    const engine = new QuizEngine();
    engine.start(1);
    let latest: QuizState;
    engine.subscribe((s) => (latest = s));

    engine.selectAnswer(0);
    engine.next();
    expect(latest!.phase).toBe("finished");
  });
});
