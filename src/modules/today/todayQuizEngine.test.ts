import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import type { DrawnPools, DrawnWord, PoolCounts } from "./srsStore.ts";

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
const drawExtraRoundPoolMock = vi.fn(async (priorWrong: DrawnWord[], _target: number): Promise<DrawnWord[]> => priorWrong);
const markWordsServedTodayMock = vi.fn(async (_words: DrawnWord[]) => {});
const recordFirstRoundResultMock = vi.fn(async (_correct: number, _total: number) => {});
const getTodayFirstRoundResultMock = vi.fn(async (): Promise<{ correct: number; total: number } | null> => null);
const metaStore = new Map<string, unknown>();

vi.mock("./srsStore.ts", () => ({
  getStudyDate: () => "2026-07-10",
  daysUntil: () => 100,
  getMeta: async (key: string) => metaStore.get(key),
  setMeta: async (key: string, value: unknown) => {
    metaStore.set(key, value);
  },
  recordAnswer: (kind: string, id: string, correct: boolean, source: string) =>
    recordAnswerMock(kind, id, correct, source),
  drawTodayPool: (counts: PoolCounts, learnedUpTo?: number) => drawTodayPoolMock(counts, learnedUpTo),
  drawExtraRoundPool: (priorWrong: DrawnWord[], target: number) => drawExtraRoundPoolMock(priorWrong, target),
  markWordsServedToday: (words: DrawnWord[]) => markWordsServedTodayMock(words),
  recordFirstRoundResult: (correct: number, total: number) => recordFirstRoundResultMock(correct, total),
  getTodayFirstRoundResult: () => getTodayFirstRoundResultMock(),
}));

const { TodayQuizEngine, getInProgressRoundSummary } = await import("./todayQuizEngine.ts");

beforeEach(() => {
  recordAnswerMock.mockClear();
  drawTodayPoolMock.mockReset();
  drawTodayPoolMock.mockResolvedValue({
    review: [{ kind: "vocab", id: "v-0" }],
    weak: [{ kind: "vocab", id: "v-2" }],
    new: [{ kind: "vocab", id: "v-3" }],
  });
  drawExtraRoundPoolMock.mockReset();
  drawExtraRoundPoolMock.mockImplementation(async (priorWrong: DrawnWord[]) => priorWrong);
  markWordsServedTodayMock.mockClear();
  recordFirstRoundResultMock.mockClear();
  getTodayFirstRoundResultMock.mockReset();
  getTodayFirstRoundResultMock.mockResolvedValue(null);
  metaStore.clear();
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

  it("goes to finished (not stuck in playing) when the pool comes up empty", async () => {
    // Regression test: start() used to hard-code phase: "playing" regardless
    // of how many questions actually got built, which the view can't tell
    // apart from "hasn't started yet" - an empty pool rendered as a
    // permanently stuck loading screen instead of a real result.
    drawTodayPoolMock.mockResolvedValue({ review: [], weak: [], new: [] });
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.phase).toBe("finished");
    expect(latest.questions).toHaveLength(0);
  });

  it("goes to finished when every drawn id fails to resolve against the current data", async () => {
    // Two bogus grammar ids already meet MIN_GRAMMAR_QUESTIONS, so
    // enforceGrammarMinimum doesn't top up with real (resolvable) grammar
    // entries - buildQuestion() then legitimately produces zero questions.
    drawTodayPoolMock.mockResolvedValue({
      review: [
        { kind: "grammar", id: "g-does-not-exist-1" },
        { kind: "grammar", id: "g-does-not-exist-2" },
      ],
      weak: [],
      new: [],
    });
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.phase).toBe("finished");
    expect(latest.questions).toHaveLength(0);
  });

  it("marks the round as roundKind 'main' and marks the drawn words as served", async () => {
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.roundKind).toBe("main");
    expect(markWordsServedTodayMock).toHaveBeenCalled();
  });

  it("transparently falls through to a weak-fill extra round if round 1 is already done today", async () => {
    getTodayFirstRoundResultMock.mockResolvedValue({ correct: 8, total: 10 });
    drawExtraRoundPoolMock.mockResolvedValue([{ kind: "vocab", id: "v-1" }]);
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.roundKind).toBe("extra");
    expect(latest.questions.map((q: { id: string }) => q.id)).toEqual(["v-1"]);
    expect(drawTodayPoolMock).not.toHaveBeenCalled();
  });

  it("resumes an in-progress round from earlier today instead of drawing a new one", async () => {
    const first = new TodayQuizEngine();
    await first.start();
    let firstState: any;
    first.subscribe((s) => (firstState = s));
    // Answer one question so currentIndex advances and gets persisted.
    first.selectOption(firstState.questions[0].answerIndex);

    // A brand new engine instance (as if the page was left and reopened)
    // must pick up right where the last one left off, not redraw.
    drawTodayPoolMock.mockClear();
    const resumed = new TodayQuizEngine();
    await resumed.start();
    let resumedState: any;
    resumed.subscribe((s) => (resumedState = s));
    expect(resumedState.phase).toBe("playing");
    expect(resumedState.questions.map((q: { id: string }) => q.id)).toEqual(
      firstState.questions.map((q: { id: string }) => q.id),
    );
    expect(resumedState.answers).toHaveLength(1);
    expect(drawTodayPoolMock).not.toHaveBeenCalled();
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
    expect(latest.roundKind).toBe("extra");
  });
});

describe("TodayQuizEngine round-completion tracking", () => {
  it("records round 1's own result via recordFirstRoundResult when a main round finishes", async () => {
    vi.useFakeTimers();
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
    expect(recordFirstRoundResultMock).toHaveBeenCalledWith(total, total);
  });

  it("does NOT call recordFirstRoundResult when an extra round finishes", async () => {
    vi.useFakeTimers();
    const engine = new TodayQuizEngine();
    engine.startWithWords([{ kind: "vocab", id: "v-0" }]);
    let latest: any;
    engine.subscribe((s) => (latest = s));
    engine.selectOption(latest.questions[0].answerIndex);
    await vi.advanceTimersByTimeAsync(600);
    expect(latest.phase).toBe("finished");
    expect(recordFirstRoundResultMock).not.toHaveBeenCalled();
  });
});

describe("TodayQuizEngine.continueRound / previewContinueCount", () => {
  it("composes this round's own wrongs plus weak-pool fill, marked as an extra round", async () => {
    vi.useFakeTimers();
    const engine = new TodayQuizEngine();
    engine.startWithWords([
      { kind: "vocab", id: "v-0" },
      { kind: "vocab", id: "v-1" },
    ]);
    let latest: any;
    engine.subscribe((s) => (latest = s));

    // Answer both questions wrong, in whatever order startWithWords() shuffled
    // them into, so both v-0 and v-1 end up in this round's own wrong list.
    for (let i = 0; i < 2; i++) {
      const q = latest.questions[latest.currentIndex];
      engine.selectOption((q.answerIndex + 1) % q.options.length);
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(latest.phase).toBe("finished");

    drawExtraRoundPoolMock.mockImplementation(async (priorWrong: DrawnWord[]) => [
      ...priorWrong,
      { kind: "vocab", id: "v-2" },
    ]);
    await engine.continueRound();
    const [calledPriorWrong, calledTarget] = drawExtraRoundPoolMock.mock.calls[0]!;
    expect(new Set((calledPriorWrong as DrawnWord[]).map((w) => w.id))).toEqual(new Set(["v-0", "v-1"]));
    expect(calledTarget).toBe(10);
    expect(latest.roundKind).toBe("extra");
    expect(latest.phase).toBe("playing");
    expect(latest.questions.map((q: { id: string }) => q.id).sort()).toEqual(["v-0", "v-1", "v-2"]);
  });

  it("previews the composed count without mutating state or marking words served", async () => {
    const engine = new TodayQuizEngine();
    engine.startWithWords([{ kind: "vocab", id: "v-0" }]);
    markWordsServedTodayMock.mockClear();
    drawExtraRoundPoolMock.mockResolvedValue([
      { kind: "vocab", id: "v-1" },
      { kind: "vocab", id: "v-2" },
    ]);
    const count = await engine.previewContinueCount();
    expect(count).toBe(2);
    expect(markWordsServedTodayMock).not.toHaveBeenCalled();
  });

  it("reports 0 (exhausted) when the wrong list and weak pool are both empty", async () => {
    const engine = new TodayQuizEngine();
    engine.startWithWords([]);
    drawExtraRoundPoolMock.mockResolvedValue([]);
    expect(await engine.previewContinueCount()).toBe(0);
  });
});

describe("getInProgressRoundSummary", () => {
  it("returns null when no round has been started", async () => {
    expect(await getInProgressRoundSummary()).toBeNull();
  });

  it("reflects the current position of a round left mid-way, derived from answers.length (not a stale pre-answer index)", async () => {
    const engine = new TodayQuizEngine();
    await engine.start();
    let latest: any;
    engine.subscribe((s) => (latest = s));
    const total = latest.questions.length;
    // Answering question 0 (even before the 600ms auto-advance fires) must
    // already show as "on to question 2" on resume - a snapshot taken right
    // after selectOption() but before next() advances currentIndex used to
    // report the stale pre-answer position and re-serve the same question.
    engine.selectOption(latest.questions[0].answerIndex);

    const summary = await getInProgressRoundSummary();
    expect(summary).toEqual({ currentIndex: 1, total });
  });

  it("returns null again once the round finishes", async () => {
    vi.useFakeTimers();
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
    expect(await getInProgressRoundSummary()).toBeNull();
  });

  // Regression: an abandoned 昨夜複習 session (roundKind "extra", no
  // 10-question cap - see startWithWords) used to leak into this summary and
  // make the home page's fixed-10 "今日學習任務" tile show a bogus total
  // (e.g. "還有 20 題") for a round that was never the main round at all.
  it("ignores a left-mid-way 'extra' round (e.g. 昨夜複習) - only 'main' rounds surface here", async () => {
    const engine = new TodayQuizEngine();
    engine.startWithWords([
      { kind: "vocab", id: "v-0" },
      { kind: "vocab", id: "v-1" },
      { kind: "vocab", id: "v-2" },
    ]);
    let latest: any;
    engine.subscribe((s) => (latest = s));
    engine.selectOption(latest.questions[0].answerIndex);

    expect(await getInProgressRoundSummary()).toBeNull();
  });
});

describe("TodayQuizEngine.startWithWords", () => {
  it("builds questions for exactly the given word list, with no ratio or grammar-minimum rules applied", () => {
    const engine = new TodayQuizEngine();
    engine.startWithWords([
      { kind: "vocab", id: "v-0" },
      { kind: "vocab", id: "v-1" },
    ]);
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.phase).toBe("playing");
    expect(latest.questions.map((q: { id: string }) => q.id).sort()).toEqual(["v-0", "v-1"]);
    expect(drawTodayPoolMock).not.toHaveBeenCalled();
  });

  it("goes straight to finished when given an empty list", () => {
    const engine = new TodayQuizEngine();
    engine.startWithWords([]);
    let latest: any;
    engine.subscribe((s) => (latest = s));
    expect(latest.phase).toBe("finished");
  });
});
