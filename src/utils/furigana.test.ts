import { describe, expect, it } from "vitest";
import { toRubyHtml } from "./furigana.ts";

describe("toRubyHtml", () => {
  it("splits off a trailing okurigana suffix", () => {
    expect(toRubyHtml("助かる", "たすかる")).toBe("<ruby>助<rt>たす</rt></ruby>かる");
  });

  it("handles a single trailing kana character", () => {
    expect(toRubyHtml("出会い", "であい")).toBe("<ruby>出会<rt>であ</rt></ruby>い");
  });

  it("rubys the whole word when there is no okurigana", () => {
    expect(toRubyHtml("高層", "こうそう")).toBe("<ruby>高層<rt>こうそう</rt></ruby>");
  });

  it("returns kana-only words unchanged", () => {
    expect(toRubyHtml("すっかり", "すっかり")).toBe("すっかり");
  });

  it("falls back to one ruby spanning the whole word for mixed leading kana", () => {
    // 見上げる: kanji has no trailing-kana/kanji split issue here, but お知らせ style
    // leading-kana words should still degrade gracefully rather than throwing.
    expect(toRubyHtml("お知らせ", "おしらせ")).toBe("<ruby>お知らせ<rt>おしらせ</rt></ruby>");
  });
});
