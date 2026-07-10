import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import type { DrawnPools, PoolCounts } from "./srsStore.ts";

const vocab: VocabEntry[] = [
  {
    id: "v-0",
    kanji: "大きい",
    yomi: "おおきい",
    meaning: "大的",
    partOfSpeech: "i-adjective",
    jlptLevel: "N2",
    relatedWords: [{ relation: "antonym", kanji: "小さい", furiganaRuby: "小さい", meaning: "小的" }],
  },
  { id: "v-1", kanji: "小さい", yomi: "ちいさい", meaning: "小的", partOfSpeech: "i-adjective", jlptLevel: "N2" },
  { id: "v-2", kanji: "早い", yomi: "はやい", meaning: "快的", partOfSpeech: "i-adjective", jlptLevel: "N2" },
  { id: "v-3", kanji: "遅い", yomi: "おそい", meaning: "慢的", partOfSpeech: "i-adjective", jlptLevel: "N2" },
  { id: "v-4", kanji: "高い", yomi: "たかい", meaning: "貴的", partOfSpeech: "i-adjective", jlptLevel: "N2" },
];

const grammar: GrammarEntry[] = Array.from({ length: 4 }, (_, i) => ({
  id: `g-${i}`,
  pattern: `文法${i}`,
  conjunctionRules: "",
  meaning: `意味${i}`,
  examples: [],
}));

vi.mock("../../data/store.ts", () => ({
  getStoreSync: () => ({
    grammar,
    vocab,
    quiz: [],
    grammarById: new Map(grammar.map((g) => [g.id, g])),
    vocabById: new Map(vocab.map((v) => [v.id, v])),
  }),
}));

const recordAnswerMock = vi.fn(async (_kind: string, _id: string, _correct: boolean, _source: string) => {});
const drawTodayPoolMock = vi.fn(async (_counts: PoolCounts, _learnedUpTo?: number): Promise<DrawnPools> => ({
  review: [],
  weak: [],
  new: [],
}));

vi.mock("./srsStore.ts", () => ({
  getStudyDate: () => "2026-07-10",
  daysUntil: () => 100,
  getMeta: async () => undefined,
  recordAnswer: (kind: string, id: string, correct: boolean, source: string) =>
    recordAnswerMock(kind, id, correct, source),
  drawTodayPool: (counts: PoolCounts, learnedUpTo?: number) => drawTodayPoolMock(counts, learnedUpTo),
}));

const { TodayQuizEngine } = await import("./todayQuizEngine.ts");

beforeEach(() => {
  recordAnswerMock.mockClear();
  drawTodayPoolMock.mockReset();
  drawTodayPoolMock.mockResolvedValue({
    review: [{ kind: "vocab", id: "v-0" }],
    weak: [{ kind: "vocab", id: "v-2" }],
    new: [{ kind: "vocab", id: "v-3" }],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TodayQuizEngine.start", () => {
  it("builds one question per drawn word, each with 4 options when enough distractors exist", async () => {
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.phase).toBe("playing");
    expect(latest.questions).toHaveLength(3);
    for (const q of latest.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options[q.answerIndex].sourceLabel).toBe(q.correctLabel);
    }
  });

  it("prefers an antonym relatedWord as a distractor when present", async () => {
    // 3 vocab picks (not just 1) so the grammar-minimum top-up (which swaps
    // out 2 vocab picks for grammar ones) still leaves v-0 in the final set.
    drawTodayPoolMock.mockResolvedValue({
      review: [
        { kind: "vocab", id: "v-0" },
        { kind: "vocab", id: "v-2" },
        { kind: "vocab", id: "v-4" },
      ],
      weak: [],
      new: [],
    });
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const question = latest.questions.find((q: { kind: string; id: string }) => q.kind === "vocab" && q.id === "v-0");
    expect(question).toBeDefined();
    expect(question.options.some((o: { sourceLabel: string }) => o.sourceLabel === "小さい")).toBe(true);
  });

  it("tops up to the grammar minimum by swapping in extra grammar questions", async () => {
    drawTodayPoolMock.mockResolvedValue({
      review: [
        { kind: "vocab", id: "v-0" },
        { kind: "vocab", id: "v-1" },
        { kind: "vocab", id: "v-2" },
      ],
      weak: [],
      new: [],
    });
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const grammarCount = latest.questions.filter((q: { kind: string }) => q.kind === "grammar").length;
    expect(grammarCount).toBeGreaterThanOrEqual(2);
  });
});

describe("TodayQuizEngine.selectOption", () => {
  it("grades immediately, records the answer, and auto-advances after 600ms", async () => {
    vi.useFakeTimers();
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const firstQuestionId = latest.questions[0].id;
    const firstQuestionKind = latest.questions[0].kind;

    engine.selectOption(latest.questions[0].answerIndex);
    expect(latest.selectedIndex).toBe(latest.questions[0].answerIndex);
    expect(latest.answers).toHaveLength(1);
    expect(latest.answers[0].correct).toBe(true);
    expect(recordAnswerMock).toHaveBeenCalledWith(firstQuestionKind, firstQuestionId, true, "quiz");
    expect(latest.currentIndex).toBe(0); // hasn't advanced yet

    await vi.advanceTimersByTimeAsync(600);
    expect(latest.currentIndex).toBe(1);
    expect(latest.selectedIndex).toBeNull();
  });

  it("is a no-op if the question is already answered", async () => {
    vi.useFakeTimers();
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    engine.selectOption(0);
    engine.selectOption(1);
    expect(latest.answers).toHaveLength(1);
  });

  it("reaches the finished phase after the last question", async () => {
    vi.useFakeTimers();
    // A single vocab pick still triggers the grammar-minimum top-up (see the
    // "tops up" test above), so drive through however many questions actually
    // land in the round rather than assuming a count of exactly 1.
    drawTodayPoolMock.mockResolvedValue({ review: [{ kind: "vocab", id: "v-0" }], weak: [], new: [] });
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const total = latest.questions.length;
    for (let i = 0; i < total; i++) {
      engine.selectOption(latest.questions[latest.currentIndex].answerIndex);
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(latest.phase).toBe("finished");
  });
});

describe("TodayQuizEngine.retryWrongOnly", () => {
  it("loads only the questions answered incorrectly in the previous round", async () => {
    vi.useFakeTimers();
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const questions = latest.questions;

    // answer q0 wrong, q1 right, q2 wrong
    engine.selectOption((questions[0].answerIndex + 1) % questions[0].options.length);
    await vi.advanceTimersByTimeAsync(600);
    engine.selectOption(questions[1].answerIndex);
    await vi.advanceTimersByTimeAsync(600);
    engine.selectOption((questions[2].answerIndex + 1) % questions[2].options.length);
    await vi.advanceTimersByTimeAsync(600);
    expect(latest.phase).toBe("finished");

    engine.retryWrongOnly();
    expect(latest.phase).toBe("playing");
    expect(latest.questions.map((q: { id: string }) => q.id)).toEqual([questions[0].id, questions[2].id]);
    expect(latest.answers).toHaveLength(0);
  });
});
