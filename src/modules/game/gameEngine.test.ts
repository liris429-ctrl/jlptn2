import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VocabEntry } from "../../data/schema.ts";
import type { GameState } from "./gameEngine.ts";

const vocab: VocabEntry[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `v-${i}`,
    kanji: `字${i}`,
    yomi: `じ${i}`,
    meaning: `意思${i}`,
    partOfSpeech: "noun" as const,
    jlptLevel: "N2" as const,
    // First three are flagged as homograph "freebies" - excluded from the game.
    // 9 eligible entries remain, still comfortably above PAIRS_PER_ROUND (8).
    gameExcluded: i < 3 ? true : undefined,
  })),
  // Two distinct words (different POS) that collapse to the identical displayed
  // Chinese clause - the real-world case (支払い/支払う both "支付,付款") that
  // motivates pickUniqueByMeaning().
  {
    id: "v-dup-a",
    kanji: "撞名甲",
    yomi: "どうめいこう",
    meaning: "重複意思",
    partOfSpeech: "noun" as const,
    jlptLevel: "N2" as const,
  },
  {
    id: "v-dup-b",
    kanji: "撞名乙",
    yomi: "どうめいおつ",
    meaning: "重複意思",
    partOfSpeech: "verb" as const,
    jlptLevel: "N2" as const,
  },
];

vi.mock("../../data/store.ts", () => ({
  getStoreSync: () => ({ vocab, grammar: [], grammarById: new Map(), vocabById: new Map() }),
}));

const { GameEngine, PAIRS_PER_ROUND, ROUND_SECONDS } = await import("./gameEngine.ts");

describe("GameEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("start() deals a 16-cell grid (8 jp + 8 zh) and enters playing phase", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));
    expect(latest!.phase).toBe("playing");
    expect(latest!.grid).toHaveLength(PAIRS_PER_ROUND * 2);
    expect(latest!.grid.filter((c) => c.kind === "jp")).toHaveLength(PAIRS_PER_ROUND);
    expect(latest!.grid.filter((c) => c.kind === "zh")).toHaveLength(PAIRS_PER_ROUND);
    expect(latest!.timeRemaining).toBe(ROUND_SECONDS);
    engine.stop();
  });

  it("matching a jp/zh pair for the same word marks both matched and increments combo", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    const [jpCell] = latest!.grid.filter((c) => c.kind === "jp");
    const zhCell = latest!.grid.find((c) => c.kind === "zh" && c.vocabId === jpCell!.vocabId)!;

    engine.selectCell(jpCell!.cellId);
    engine.selectCell(zhCell.cellId);

    expect(latest!.combo).toBe(1);
    expect(latest!.maxCombo).toBe(1);
    expect(latest!.sessionTotalMatches).toBe(1);
    const matchedJp = latest!.grid.find((c) => c.cellId === jpCell!.cellId)!;
    expect(matchedJp.state).toBe("matched");
    engine.stop();
  });

  it("selecting a mismatched pair resets combo and flashes wrong, then clears", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    const jpCell = latest!.grid.find((c) => c.kind === "jp")!;
    const zhCell = latest!.grid.find((c) => c.kind === "zh" && c.vocabId !== jpCell.vocabId)!;

    engine.selectCell(jpCell.cellId);
    engine.selectCell(zhCell.cellId);

    expect(latest!.combo).toBe(0);
    expect(latest!.sessionWrong).toBe(1);
    expect(latest!.grid.find((c) => c.cellId === jpCell.cellId)!.state).toBe("wrong-flash");

    vi.advanceTimersByTime(500);
    expect(latest!.grid.find((c) => c.cellId === jpCell.cellId)!.state).toBe("idle");
    engine.stop();
  });

  it("records both vocab ids from a mismatch in wrongVocabIds, deduped across repeats", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    const jpCell = latest!.grid.find((c) => c.kind === "jp")!;
    const zhCell = latest!.grid.find((c) => c.kind === "zh" && c.vocabId !== jpCell.vocabId)!;

    engine.selectCell(jpCell.cellId);
    engine.selectCell(zhCell.cellId);
    expect(new Set(latest!.wrongVocabIds)).toEqual(new Set([jpCell.vocabId, zhCell.vocabId]));

    // Repeating the same wrong pair should not duplicate entries.
    vi.advanceTimersByTime(500);
    engine.selectCell(jpCell.cellId);
    engine.selectCell(zhCell.cellId);
    expect(latest!.wrongVocabIds).toHaveLength(2);
    engine.stop();
  });

  it("clearing all 8 pairs before time runs out refills the grid and keeps the session total", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    for (let round = 0; round < PAIRS_PER_ROUND; round++) {
      const jpCells = latest!.grid.filter((c) => c.kind === "jp" && c.state !== "matched");
      const jpCell = jpCells[0]!;
      const zhCell = latest!.grid.find((c) => c.kind === "zh" && c.vocabId === jpCell.vocabId)!;
      engine.selectCell(jpCell.cellId);
      engine.selectCell(zhCell.cellId);
    }

    expect(latest!.sessionTotalMatches).toBe(PAIRS_PER_ROUND);
    expect(latest!.matchesThisRound).toBe(0);
    expect(latest!.grid.filter((c) => c.state === "matched")).toHaveLength(0);
    engine.stop();
  });

  it("never draws vocab flagged as gameExcluded", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    const excludedIds = new Set(["v-0", "v-1", "v-2"]);
    for (const cell of latest!.grid) {
      expect(excludedIds.has(cell.vocabId)).toBe(false);
    }
    engine.stop();
  });

  it("never draws two vocab entries whose first-clause meaning collides within the same round", () => {
    const engine = new GameEngine();
    for (let i = 0; i < 30; i++) {
      engine.start();
      let latest: GameState;
      engine.subscribe((s) => (latest = s));
      const zhDisplays = latest!.grid.filter((c) => c.kind === "zh").map((c) => c.display);
      expect(new Set(zhDisplays).size).toBe(zhDisplays.length);
      engine.stop();
    }
  });

  it("timer reaching zero ends the round", () => {
    const engine = new GameEngine();
    engine.start();
    let latest: GameState;
    engine.subscribe((s) => (latest = s));

    vi.advanceTimersByTime(ROUND_SECONDS * 1000);
    expect(latest!.phase).toBe("gameOver");
    expect(latest!.timeRemaining).toBe(0);
  });
});
