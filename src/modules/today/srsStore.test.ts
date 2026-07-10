import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { _resetDbForTest, dbGet, STORE_WORD_STATE } from "./db.ts";

const grammar: GrammarEntry[] = Array.from({ length: 6 }, (_, i) => ({
  id: `g-${i}`,
  pattern: `文法${i}`,
  conjunctionRules: "",
  meaning: `意味${i}`,
  lesson: `第${i + 1}課`,
  examples: [],
}));

const vocab: VocabEntry[] = Array.from({ length: 6 }, (_, i) => ({
  id: `v-${i}`,
  kanji: `単語${i}`,
  yomi: `たんご${i}`,
  meaning: `意思${i}`,
  partOfSpeech: "noun" as const,
  jlptLevel: "N2" as const,
}));

vi.mock("../../data/store.ts", () => ({
  getStoreSync: () => ({ grammar, vocab, quiz: [], grammarById: new Map(), vocabById: new Map() }),
}));

const {
  getStudyDate,
  daysUntil,
  recordAnswer,
  touchWord,
  getDueCount,
  getWeakCount,
  getRecentWrongEntries,
  getStreak,
  getWeekSummary,
  drawTodayPool,
  setMeta,
  getMeta,
} = await import("./srsStore.ts");

function localTs(y: number, m: number, d: number, h = 12, mi = 0): number {
  return new Date(y, m - 1, d, h, mi).getTime();
}

beforeEach(async () => {
  await _resetDbForTest();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("n2tan-srs");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe("getStudyDate", () => {
  it("counts before 4am as the previous day", () => {
    expect(getStudyDate(localTs(2026, 7, 10, 3, 30))).toBe("2026-07-09");
  });

  it("counts 4am and later as the same day", () => {
    expect(getStudyDate(localTs(2026, 7, 10, 5, 0))).toBe("2026-07-10");
    expect(getStudyDate(localTs(2026, 7, 10, 4, 0))).toBe("2026-07-10");
  });
});

describe("daysUntil", () => {
  it("computes calendar-day difference between two date strings", () => {
    expect(daysUntil("2026-12-06", "2026-07-10")).toBe(149);
    expect(daysUntil("2026-07-10", "2026-07-10")).toBe(0);
    expect(daysUntil("2026-07-01", "2026-07-10")).toBe(-9);
  });
});

describe("recordAnswer", () => {
  it("advances srsInterval up the 1/3/7/14/30 ladder on correct answers", async () => {
    const now = localTs(2026, 7, 10, 12, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    await recordAnswer("vocab", "v-0", true, "quiz");
    let state = await dbGet<{ srsInterval: number; srsDue: string }>(STORE_WORD_STATE, "vocab:v-0");
    expect(state?.srsInterval).toBe(1);
    expect(state?.srsDue).toBe("2026-07-11");

    await recordAnswer("vocab", "v-0", true, "quiz");
    state = await dbGet(STORE_WORD_STATE, "vocab:v-0");
    expect(state?.srsInterval).toBe(3);

    await recordAnswer("vocab", "v-0", true, "quiz");
    state = await dbGet(STORE_WORD_STATE, "vocab:v-0");
    expect(state?.srsInterval).toBe(7);
    vi.restoreAllMocks();
  });

  it("resets srsInterval to 1 and updates lastWrongAt on a wrong answer", async () => {
    const now = localTs(2026, 7, 10, 12, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    await recordAnswer("vocab", "v-0", true, "quiz");
    await recordAnswer("vocab", "v-0", true, "quiz"); // interval now 3
    await recordAnswer("vocab", "v-0", false, "quiz");
    const state = await dbGet<{ srsInterval: number; srsDue: string; lastWrongAt: number }>(
      STORE_WORD_STATE,
      "vocab:v-0",
    );
    expect(state?.srsInterval).toBe(1);
    expect(state?.srsDue).toBe("2026-07-11");
    expect(state?.lastWrongAt).toBe(now);
    vi.restoreAllMocks();
  });

  it("caps recent at 10 events and recomputes mastery from them", async () => {
    for (let i = 0; i < 12; i++) {
      await recordAnswer("vocab", "v-1", i < 2, "quiz"); // first 2 correct, rest wrong
    }
    const state = await dbGet<{ recent: { r: number }[]; mastery: number }>(STORE_WORD_STATE, "vocab:v-1");
    expect(state?.recent).toHaveLength(10);
    // last 10 events: 0 correct (the 2 correct ones fell out of the window)
    expect(state?.mastery).toBe(0);
  });
});

describe("touchWord", () => {
  it("creates a record with srsInterval 3 / srsDue 3 days out when absent", async () => {
    const now = localTs(2026, 7, 10, 12, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    await touchWord("grammar", "g-0");
    const state = await dbGet<{ srsInterval: number; srsDue: string; seen: number }>(STORE_WORD_STATE, "grammar:g-0");
    expect(state?.srsInterval).toBe(3);
    expect(state?.srsDue).toBe("2026-07-13");
    expect(state?.seen).toBe(0);
    vi.restoreAllMocks();
  });

  it("does nothing if the word already has a record", async () => {
    await recordAnswer("grammar", "g-0", true, "quiz");
    const before = await dbGet<{ seen: number }>(STORE_WORD_STATE, "grammar:g-0");
    await touchWord("grammar", "g-0");
    const after = await dbGet<{ seen: number }>(STORE_WORD_STATE, "grammar:g-0");
    expect(after).toEqual(before);
  });
});

describe("getDueCount / getWeakCount", () => {
  it("only counts words with srsDue on or before today, excluding never-touched words", async () => {
    const now = localTs(2026, 7, 10, 12, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    await recordAnswer("vocab", "v-0", false, "quiz"); // due tomorrow -> not due today
    expect(await getDueCount()).toBe(0);

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 11, 12, 0));
    expect(await getDueCount()).toBe(1); // now "today" has caught up to its due date
    vi.restoreAllMocks();
  });

  it("only counts mastery < 0.6 with seen >= 3", async () => {
    // 1 correct out of 3 -> mastery 0.33, seen 3 -> weak
    await recordAnswer("vocab", "v-0", true, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    expect(await getWeakCount()).toBe(1);

    // seen only 2 -> not weak yet even though mastery is low
    await recordAnswer("vocab", "v-1", false, "quiz");
    await recordAnswer("vocab", "v-1", false, "quiz");
    expect(await getWeakCount()).toBe(1);
  });
});

describe("getRecentWrongEntries", () => {
  it("ranks by wrong count desc then recency desc, within the last 7 days", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz"); // 1 wrong
    await recordAnswer("vocab", "v-1", false, "quiz");
    await recordAnswer("vocab", "v-1", false, "quiz"); // 2 wrong - should rank first
    const entries = await getRecentWrongEntries(5);
    expect(entries.map((e) => e.id)).toEqual(["v-1", "v-0"]);
    vi.restoreAllMocks();
  });

  it("excludes words wrong more than 7 days ago", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz");
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    const entries = await getRecentWrongEntries(5);
    expect(entries).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe("getStreak", () => {
  it("counts consecutive answered days walking back, not broken by today being untouched yet", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 8, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz");
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 9, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz");
    // "today" (7/10) has no answers yet
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    expect(await getStreak()).toBe(2);
    vi.restoreAllMocks();
  });

  it("breaks the streak on a gap day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 8, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz");
    // 7/9 has no answers - gap
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    expect(await getStreak()).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("getWeekSummary", () => {
  it("reports null accuracy when under 20 answers this week", async () => {
    await recordAnswer("vocab", "v-0", true, "quiz");
    const summary = await getWeekSummary();
    expect(summary.totalAnswered).toBe(1);
    expect(summary.accuracyPct).toBeNull();
    expect(summary.weakerCategory).toBeNull();
  });

  it("computes accuracy once 20+ answers exist this week", async () => {
    for (let i = 0; i < 20; i++) {
      await recordAnswer("vocab", "v-0", i % 2 === 0, "quiz");
    }
    const summary = await getWeekSummary();
    expect(summary.totalAnswered).toBe(20);
    expect(summary.accuracyPct).toBe(50);
  });
});

describe("drawTodayPool", () => {
  it("draws disjoint pools respecting requested counts and never repeats a word", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    // make v-0..v-2 due today (answer wrong so srsDue = tomorrow of 7/1 = 7/2)
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-1", false, "quiz");
    // make v-2 weak (mastery < 0.6, seen >= 3), but not due (answer correct last so it's scheduled later)
    await recordAnswer("vocab", "v-2", false, "quiz");
    await recordAnswer("vocab", "v-2", false, "quiz");
    await recordAnswer("vocab", "v-2", true, "quiz");

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));
    const pools = await drawTodayPool({ review: 2, weak: 1, new: 2 });
    const allIds = [...pools.review, ...pools.weak, ...pools.new].map((w) => `${w.kind}:${w.id}`);
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates across pools
    expect(pools.review.length).toBeLessThanOrEqual(2);
    expect(pools.weak.length).toBeLessThanOrEqual(1);
    expect(pools.new.length).toBeLessThanOrEqual(2);
    vi.restoreAllMocks();
  });

  it("scopes the new-grammar pool to learnedUpTo when set", async () => {
    const pools = await drawTodayPool({ review: 0, weak: 0, new: 10 }, 2);
    const newGrammarIds = pools.new.filter((w) => w.kind === "grammar").map((w) => w.id);
    // only g-0 (第1課) and g-1 (第2課) are within learnedUpTo=2
    for (const id of newGrammarIds) {
      expect(["g-0", "g-1"]).toContain(id);
    }
  });
});

describe("meta", () => {
  it("round-trips a value through setMeta/getMeta", async () => {
    expect(await getMeta("examDate")).toBeUndefined();
    await setMeta("examDate", "2026-12-06");
    expect(await getMeta("examDate")).toBe("2026-12-06");
  });
});
