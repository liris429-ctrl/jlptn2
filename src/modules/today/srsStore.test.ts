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
  senses: [{ text: `意味${i}`, lessonSubgroup: `第${i + 1}課`, exampleIds: [] }],
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
  markWordLearned,
  getDueCount,
  getWeakCount,
  getNewCount,
  getRecentWrongEntries,
  recentWrongCount,
  getYesterdayNewWords,
  getStreak,
  getWeekSummary,
  drawTodayPool,
  drawExtraRoundPool,
  markWordsServedToday,
  recordFirstRoundResult,
  getTodayFirstRoundResult,
  getDailyStatsRange,
  getDailyGrammarPick,
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

describe("markWordLearned", () => {
  it("creates a record with srsInterval 1 / srsDue tomorrow when absent, and returns true", async () => {
    const now = localTs(2026, 7, 10, 12, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const created = await markWordLearned("grammar", "g-0");
    const state = await dbGet<{ srsInterval: number; srsDue: string; seen: number; recent: { r: number; t: string }[] }>(
      STORE_WORD_STATE,
      "grammar:g-0",
    );
    expect(created).toBe(true);
    expect(state?.srsInterval).toBe(1);
    expect(state?.srsDue).toBe("2026-07-11");
    expect(state?.seen).toBe(1);
    vi.restoreAllMocks();
  });

  // Regression: markWordLearned used to only seed schedule metadata
  // (srsInterval/srsDue) without pushing a `recent` entry, so
  // getYesterdayNewWords() - which requires an actual `recent` event dated
  // yesterday, not just firstSeenAt - could never pick the word up the next
  // day. The "已學習" button's own toast promises "already added to
  // tomorrow's study list", so this must hold.
  it("pushes a recent event so the word qualifies for getYesterdayNewWords() the next day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    await markWordLearned("grammar", "g-0");
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 11, 12, 0));
    const words = await getYesterdayNewWords();
    expect(words.map((w) => w.id)).toContain("g-0");
    vi.restoreAllMocks();
  });

  it("does nothing and returns false if the word already has a record", async () => {
    await recordAnswer("grammar", "g-0", true, "quiz");
    const before = await dbGet<{ seen: number; srsDue: string }>(STORE_WORD_STATE, "grammar:g-0");
    const created = await markWordLearned("grammar", "g-0");
    const after = await dbGet<{ seen: number; srsDue: string }>(STORE_WORD_STATE, "grammar:g-0");
    expect(created).toBe(false);
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

  it("excludes a word once its only recent-window wrong has been pushed out of `recent` by later correct answers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz"); // lastWrongAt = 7/1
    for (let i = 0; i < 10; i++) {
      await recordAnswer("vocab", "v-0", true, "quiz"); // evicts the wrong event from `recent` (10-item cap)
    }
    // lastWrongAt (7/1) is still within the 7-day window as of "now" (7/2),
    // but the wrong event itself no longer exists in `recent` - eligibility
    // must follow the live recentWrongCount, not the now-stale lastWrongAt.
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));
    const entries = await getRecentWrongEntries(5);
    expect(entries.map((e) => e.id)).not.toContain("v-0");
    vi.restoreAllMocks();
  });
});

describe("recentWrongCount", () => {
  it("only counts wrong events whose own timestamp falls within the window, ignoring lastWrongAt", () => {
    const now = localTs(2026, 7, 10, 12, 0);
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const w = {
      key: "vocab:v-0",
      kind: "vocab" as const,
      id: "v-0",
      seen: 2,
      correct: 0,
      recent: [
        { r: 0 as const, t: "quiz" as const, ts: eightDaysAgo },
        { r: 0 as const, t: "quiz" as const, ts: now },
      ],
      mastery: 0,
      srsDue: null,
      srsInterval: 0,
      lastReviewed: null,
      lastWrongAt: now,
      firstSeenAt: eightDaysAgo,
      fav: false,
      note: "",
    };
    expect(recentWrongCount(w, now)).toBe(1);
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

  it("tops up a shortfall from other pools (review -> weak -> new) instead of returning fewer than requested", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    // Only v-0 is due today; nothing is weak. review asks for 3 but only 1
    // exists - the other 2 should be topped up from the new-word pool
    // (there's no weak candidate at all here, so weak's leftover is empty).
    await recordAnswer("vocab", "v-0", false, "quiz");
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));

    const pools = await drawTodayPool({ review: 3, weak: 0, new: 0 });
    const allIds = [...pools.review, ...pools.weak, ...pools.new].map((w) => `${w.kind}:${w.id}`);
    expect(new Set(allIds).size).toBe(allIds.length); // still no duplicates
    expect(allIds.length).toBe(3); // shortfall filled from the new pool, not left at 1
    vi.restoreAllMocks();
  });

  it("excludes words already served today, even if otherwise eligible (e.g. an abandoned-and-restarted round 1)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz"); // due tomorrow (7/2)
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));

    await markWordsServedToday([{ kind: "vocab", id: "v-0" }]);
    const pools = await drawTodayPool({ review: 5, weak: 0, new: 0 });
    const allIds = [...pools.review, ...pools.weak, ...pools.new].map((w) => `${w.kind}:${w.id}`);
    expect(allIds).not.toContain("vocab:v-0");
    vi.restoreAllMocks();
  });
});

describe("markWordsServedToday / drawExtraRoundPool", () => {
  it("puts priorWrong first, then pads with weak-pool fill up to target", async () => {
    for (const id of ["v-1", "v-2"]) {
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
    }
    const composed = await drawExtraRoundPool([{ kind: "vocab", id: "v-0" }], 2);
    expect(composed[0]).toEqual({ kind: "vocab", id: "v-0" });
    expect(composed).toHaveLength(2);
  });

  it("excludes an already-served word when today's own exposure was correct", async () => {
    for (const id of ["v-1", "v-2"]) {
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
    }
    // Weak from yesterday's wrongs (mastery stays well under the 0.6
    // ceiling even after today's single correct answer), but nothing wrong
    // happened today - this is the "don't hammer something you just got
    // right" case the served-today exclusion exists for.
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz");
    await markWordsServedToday([{ kind: "vocab", id: "v-0" }]);
    const composed = await drawExtraRoundPool([], 10);
    expect(composed.map((w) => w.id)).not.toContain("v-0");
    vi.restoreAllMocks();
  });

  // Regression: drawExtraRoundPool used to exclude ANY word served today,
  // even one the user just got wrong in round 1 - so the home page's
  // "再練N題" button (a cold navigation with no in-memory priorWrong to
  // inherit from a just-finished round) could never resurface today's own
  // mistakes, shrinking to almost nothing right after a round with several
  // wrong answers.
  it("does NOT exclude an already-served word that was answered wrong today", async () => {
    for (const id of ["v-1", "v-2"]) {
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
    }
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await markWordsServedToday([{ kind: "vocab", id: "v-0" }]);
    const composed = await drawExtraRoundPool([], 10);
    expect(composed.map((w) => w.id)).toContain("v-0");
  });

  it("naturally shrinks to empty once priorWrong and the weak pool both run dry", async () => {
    expect(await drawExtraRoundPool([], 10)).toHaveLength(0);
  });

  it("is pure - doesn't itself mark anything as served", async () => {
    for (const id of ["v-0"]) {
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
      await recordAnswer("vocab", id, false, "quiz");
    }
    await drawExtraRoundPool([], 10);
    // Calling it again should still see v-0 as available, since the first
    // call didn't mark it served on its own.
    const second = await drawExtraRoundPool([], 10);
    expect(second.map((w) => w.id)).toContain("v-0");
  });

  it("resets the served-today record on a new study day", async () => {
    // Weak from an earlier wrong streak (so it's pool-eligible independent
    // of today's own result), then a correct answer specifically on day 1 -
    // isolates the day-boundary reset from the separate wrong-today
    // carve-out covered above.
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 6, 30, 12, 0));
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");
    await recordAnswer("vocab", "v-0", false, "quiz");

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 1, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz");
    await markWordsServedToday([{ kind: "vocab", id: "v-0" }]);
    expect((await drawExtraRoundPool([], 10)).map((w) => w.id)).not.toContain("v-0");

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 2, 12, 0));
    expect((await drawExtraRoundPool([], 10)).map((w) => w.id)).toContain("v-0");
    vi.restoreAllMocks();
  });
});

describe("recordFirstRoundResult / getTodayFirstRoundResult", () => {
  it("is null before round 1 finishes today", async () => {
    expect(await getTodayFirstRoundResult()).toBeNull();
  });

  it("stores and returns round 1's own score", async () => {
    await recordFirstRoundResult(8, 10);
    expect(await getTodayFirstRoundResult()).toEqual({ correct: 8, total: 10 });
  });

  it("doesn't interfere with the running answered/correct daily totals", async () => {
    await recordAnswer("vocab", "v-0", true, "quiz");
    await recordFirstRoundResult(1, 1);
    const stats = await getDailyStatsRange(1);
    expect(stats[0]!.answered).toBe(1);
    expect(stats[0]!.firstRound).toEqual({ correct: 1, total: 1 });
  });
});

describe("meta", () => {
  it("round-trips a value through setMeta/getMeta", async () => {
    expect(await getMeta("examDate")).toBeUndefined();
    await setMeta("examDate", "2026-12-06");
    expect(await getMeta("examDate")).toBe("2026-12-06");
  });
});

describe("getNewCount", () => {
  it("matches the size of drawTodayPool's new-word candidate set", async () => {
    const countAll = await getNewCount();
    expect(countAll).toBe(grammar.length + vocab.length);

    await touchWord("vocab", "v-0");
    expect(await getNewCount()).toBe(countAll - 1);
  });

  it("respects learnedUpTo the same way drawTodayPool does", async () => {
    const count = await getNewCount(2);
    // only g-0/g-1 grammar (第1課/第2課) qualify, plus all 6 vocab (no lesson data)
    expect(count).toBe(2 + vocab.length);
  });
});

describe("getYesterdayNewWords", () => {
  it("only includes words first seen yesterday with at least one real event", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 9, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz"); // firstSeenAt yesterday, has a real event
    await touchWord("vocab", "v-1"); // firstSeenAt yesterday, but only ever browsed - excluded

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    await touchWord("vocab", "v-2"); // firstSeenAt today - not "yesterday"

    const words = await getYesterdayNewWords();
    expect(words.map((w) => w.id)).toEqual(["v-0"]);
    vi.restoreAllMocks();
  });

  it("excludes a word once its own yesterday event has been pushed out of `recent` by heavy same-day retesting today", async () => {
    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 9, 12, 0));
    await recordAnswer("vocab", "v-0", true, "quiz"); // firstSeenAt + one real event, both yesterday

    vi.spyOn(Date, "now").mockReturnValue(localTs(2026, 7, 10, 12, 0));
    for (let i = 0; i < 10; i++) {
      await recordAnswer("vocab", "v-0", true, "quiz"); // 10 more today - evicts yesterday's own event from `recent`
    }

    const words = await getYesterdayNewWords();
    expect(words.map((w) => w.id)).not.toContain("v-0");
    vi.restoreAllMocks();
  });
});

describe("getDailyGrammarPick", () => {
  it("picks the same grammar entry for the same seed date, from untouched entries", async () => {
    const a = await getDailyGrammarPick("2026-07-10");
    const b = await getDailyGrammarPick("2026-07-10");
    expect(a).toBe(b);
    expect(["g-0", "g-1", "g-2", "g-3", "g-4", "g-5"]).toContain(a);
  });

  it("falls back to the lowest-mastery grammar entry once all are touched", async () => {
    for (const g of grammar) {
      await touchWord("grammar", g.id);
    }
    // make g-2 the clear lowest mastery
    await recordAnswer("grammar", "g-2", false, "quiz");
    await recordAnswer("grammar", "g-2", false, "quiz");
    for (const g of grammar) {
      if (g.id !== "g-2") await recordAnswer("grammar", g.id, true, "quiz");
    }
    expect(await getDailyGrammarPick("2026-07-10")).toBe("g-2");
  });

  it("ignores a seen<3 fluke's raw-zero mastery in favor of a genuinely tested weak entry", async () => {
    for (const g of grammar) {
      await touchWord("grammar", g.id);
    }
    // g-2: chronically weak - tested enough (seen=5), mastery=0.2.
    for (let i = 0; i < 4; i++) await recordAnswer("grammar", "g-2", false, "quiz");
    await recordAnswer("grammar", "g-2", true, "quiz");
    // g-5: only touched once and got it wrong (seen=1, mastery=0) - lower raw
    // mastery than g-2, but must NOT win since it hasn't been tested enough.
    await recordAnswer("grammar", "g-5", false, "quiz");
    // Everyone else stays under seen>=3 too (only 2 answers each), so g-2 is
    // the *only* entry eligible for tier 2 - keeps this test independent of
    // tier 2's own "random pick among the weakest pool" behavior.
    for (const g of grammar) {
      if (g.id !== "g-2" && g.id !== "g-5") {
        await recordAnswer("grammar", g.id, true, "quiz");
        await recordAnswer("grammar", g.id, true, "quiz");
      }
    }
    expect(await getDailyGrammarPick("2026-07-10")).toBe("g-2");
  });

  it("varies which weak-spot entry is picked across days instead of always the single worst one", async () => {
    for (const g of grammar) {
      await touchWord("grammar", g.id);
    }
    // Give all 6 entries seen>=3 with a spread of masteries, so tier 2's pool
    // has several eligible candidates (not just one clear winner).
    for (let i = 0; i < grammar.length; i++) {
      const wrongCount = i; // g-0: 0 wrong (mastery 1) ... g-5: 3 wrong (mastery 0)
      for (let j = 0; j < 3; j++) {
        await recordAnswer("grammar", grammar[i]!.id, j >= wrongCount, "quiz");
      }
    }
    const picks = new Set<string | null>();
    for (let d = 1; d <= 15; d++) {
      picks.add(await getDailyGrammarPick(`2026-02-${String(d).padStart(2, "0")}`));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("keeps returning today's already-locked-in pick even after later touches shrink the candidate pool", async () => {
    const picked = await getDailyGrammarPick("2026-07-10");
    expect(picked).not.toBeNull();
    // Touching the picked entry itself (e.g. the user reading it) used to
    // shrink `untouched` and shift the seeded index against the smaller
    // pool, silently changing "today's" result mid-day.
    await touchWord("grammar", picked!);
    expect(await getDailyGrammarPick("2026-07-10")).toBe(picked);

    // Touching a completely different entry must not change it either.
    const other = grammar.find((g) => g.id !== picked)!.id;
    await touchWord("grammar", other);
    expect(await getDailyGrammarPick("2026-07-10")).toBe(picked);
  });

  it("falls back to raw lowest mastery when nothing has reached seen>=3 yet", async () => {
    for (const g of grammar) {
      await touchWord("grammar", g.id);
    }
    // Everything is touched (no untouched tier), but every entry is under the
    // seen>=3 threshold - the tier-2 weak-spot set is empty, so this must
    // still return a real pick (tier 3) instead of null.
    await recordAnswer("grammar", "g-2", false, "quiz");
    await recordAnswer("grammar", "g-2", false, "quiz"); // seen=2, mastery=0
    for (const g of grammar) {
      if (g.id !== "g-2") await recordAnswer("grammar", g.id, true, "quiz"); // seen=1, mastery=1
    }
    expect(await getDailyGrammarPick("2026-07-10")).toBe("g-2");
  });
});
