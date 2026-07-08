import { describe, expect, it } from "vitest";
import { compareYomi } from "./kana.ts";

describe("compareYomi", () => {
  it("orders hiragana in gojuon (aiueo) order", () => {
    const words = ["うた", "あさ", "かさ", "いぬ"];
    expect([...words].sort(compareYomi)).toEqual(["あさ", "いぬ", "うた", "かさ"]);
  });

  it("treats a word as equal to itself", () => {
    expect(compareYomi("ねこ", "ねこ")).toBe(0);
  });

  it("folds katakana to hiragana before comparing, so readings interleave correctly", () => {
    // パン (pan) is semi-voiced は-row, so it belongs right after はな/ばな and
    // before ひも - not dumped after every hiragana entry as a separate "script".
    const words = ["ひも", "はな", "パン"];
    const sorted = [...words].sort(compareYomi);
    expect(sorted).toEqual(["はな", "パン", "ひも"]);
  });
});
