import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";

const grammar: GrammarEntry[] = [
  {
    id: "wake-ga-nai",
    pattern: "～わけがない",
    conjunctionRules: "普通形+わけがない",
    meaning: "不可能～",
    examples: [],
  },
];

const vocab: VocabEntry[] = [
  {
    id: "v-接続-せつぞく",
    kanji: "接続",
    yomi: "せつぞく",
    meaning: "连接、接续",
    partOfSpeech: "noun",
    jlptLevel: "N2",
  },
];

vi.mock("../../data/store.ts", () => ({
  getStoreSync: () => ({ grammar, vocab, grammarById: new Map(), vocabById: new Map() }),
}));

const { search, resetSearchIndex } = await import("./searchIndex.ts");

describe("search", () => {
  beforeEach(() => resetSearchIndex());

  it("finds a vocab entry by kanji", () => {
    expect(search("接続").map((r) => r.id)).toContain("v-接続-せつぞく");
  });

  it("finds a vocab entry by kana reading (katakana query folds to hiragana)", () => {
    expect(search("セツゾク").map((r) => r.id)).toContain("v-接続-せつぞく");
  });

  it("finds a vocab entry by Chinese meaning substring", () => {
    expect(search("连接").map((r) => r.id)).toContain("v-接続-せつぞく");
  });

  it("finds a grammar entry by pattern substring", () => {
    expect(search("わけがない").map((r) => r.id)).toContain("wake-ga-nai");
  });

  it("returns empty results for an empty query", () => {
    expect(search("")).toEqual([]);
  });

  it("kind filter excludes the other kind's matches", () => {
    expect(search("接続", { kind: "grammar" })).toEqual([]);
    expect(search("わけがない", { kind: "vocab" })).toEqual([]);
  });

  it("kind filter keeps matches of the requested kind", () => {
    expect(search("接続", { kind: "vocab" }).map((r) => r.id)).toContain("v-接続-せつぞく");
    expect(search("わけがない", { kind: "grammar" }).map((r) => r.id)).toContain("wake-ga-nai");
  });
});
