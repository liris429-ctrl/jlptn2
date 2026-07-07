import { describe, expect, it } from "vitest";
import { conjugateIAdjective, conjugateVerb, getSurfaceForms } from "./conjugate.ts";
import type { VocabEntry } from "../../data/schema.ts";

describe("conjugateVerb: godan rows", () => {
  it("godan-u: 買う", () => {
    const f = conjugateVerb("買う", "godan-u");
    expect(f.masu).toBe("買います");
    expect(f.te).toBe("買って");
    expect(f.ta).toBe("買った");
    expect(f.nai).toBe("買わない");
    expect(f.potential).toBe("買える");
    expect(f.volitional).toBe("買おう");
  });

  it("godan-ku: 書く", () => {
    const f = conjugateVerb("書く", "godan-ku");
    expect(f.masu).toBe("書きます");
    expect(f.te).toBe("書いて");
    expect(f.ta).toBe("書いた");
    expect(f.nai).toBe("書かない");
  });

  it("godan-gu: 泳ぐ", () => {
    const f = conjugateVerb("泳ぐ", "godan-gu");
    expect(f.te).toBe("泳いで");
    expect(f.ta).toBe("泳いだ");
    expect(f.nai).toBe("泳がない");
  });

  it("godan-su: 話す", () => {
    const f = conjugateVerb("話す", "godan-su");
    expect(f.te).toBe("話して");
    expect(f.ta).toBe("話した");
    expect(f.nai).toBe("話さない");
  });

  it("godan-tsu: 待つ", () => {
    const f = conjugateVerb("待つ", "godan-tsu");
    expect(f.te).toBe("待って");
    expect(f.ta).toBe("待った");
    expect(f.nai).toBe("待たない");
  });

  it("godan-nu: 死ぬ", () => {
    const f = conjugateVerb("死ぬ", "godan-nu");
    expect(f.te).toBe("死んで");
    expect(f.ta).toBe("死んだ");
    expect(f.nai).toBe("死なない");
  });

  it("godan-bu: 遊ぶ", () => {
    const f = conjugateVerb("遊ぶ", "godan-bu");
    expect(f.te).toBe("遊んで");
    expect(f.ta).toBe("遊んだ");
    expect(f.nai).toBe("遊ばない");
  });

  it("godan-mu: 飲む", () => {
    const f = conjugateVerb("飲む", "godan-mu");
    expect(f.te).toBe("飲んで");
    expect(f.ta).toBe("飲んだ");
    expect(f.nai).toBe("飲まない");
  });

  it("godan-ru trap: 帰る conjugates as godan, not ichidan", () => {
    const f = conjugateVerb("帰る", "godan-ru");
    // If this were mistakenly treated as ichidan, masu would wrongly be "帰ます".
    expect(f.masu).toBe("帰ります");
    expect(f.te).toBe("帰って");
    expect(f.ta).toBe("帰った");
    expect(f.nai).toBe("帰らない");
    expect(f.potential).toBe("帰れる");
  });
});

describe("conjugateVerb: irregulars", () => {
  it("行く has irregular te/ta despite being godan-ku", () => {
    const f = conjugateVerb("行く", "godan-ku");
    expect(f.te).toBe("行って");
    expect(f.ta).toBe("行った");
    expect(f.masu).toBe("行きます");
    expect(f.nai).toBe("行かない");
  });

  it("ichidan: 食べる", () => {
    const f = conjugateVerb("食べる", "ichidan");
    expect(f.masu).toBe("食べます");
    expect(f.te).toBe("食べて");
    expect(f.ta).toBe("食べた");
    expect(f.nai).toBe("食べない");
    expect(f.potential).toBe("食べられる");
  });

  it("する compound verb: 勉強する", () => {
    const f = conjugateVerb("勉強する", "suru");
    expect(f.masu).toBe("勉強します");
    expect(f.te).toBe("勉強して");
    expect(f.ta).toBe("勉強した");
    expect(f.nai).toBe("勉強しない");
    expect(f.potential).toBe("勉強できる");
  });

  it("bare する", () => {
    const f = conjugateVerb("する", "suru");
    expect(f.masu).toBe("します");
    expect(f.potential).toBe("できる");
  });

  it("来る", () => {
    const f = conjugateVerb("来る", "kuru");
    expect(f.masu).toBe("来ます");
    expect(f.te).toBe("来て");
    expect(f.ta).toBe("来た");
    expect(f.nai).toBe("来ない");
    expect(f.potential).toBe("来られる");
    expect(f.imperative).toBe("来い");
  });

  it("overrideForms take precedence over generated forms", () => {
    const f = conjugateVerb("行く", "godan-ku", { potential: "行けるかも" });
    expect(f.potential).toBe("行けるかも");
    expect(f.te).toBe("行って");
  });
});

describe("conjugateIAdjective", () => {
  it("いい is irregular: reverts to よ stem for every non-plain form", () => {
    const f = conjugateIAdjective("いい");
    expect(f.nai).toBe("よくない");
    expect(f.ta).toBe("よかった");
    expect(f.te).toBe("よくて");
  });

  it("良い (kanji form) conjugates regularly, keeping the kanji stem", () => {
    const f = conjugateIAdjective("良い");
    expect(f.nai).toBe("良くない");
    expect(f.ta).toBe("良かった");
  });

  it("かわいい merely ends in いい but is not the irregular word", () => {
    const f = conjugateIAdjective("かわいい");
    expect(f.nai).toBe("かわいくない");
    expect(f.ta).toBe("かわいかった");
  });

  it("regular i-adjective: 高い", () => {
    const f = conjugateIAdjective("高い");
    expect(f.nai).toBe("高くない");
    expect(f.ta).toBe("高かった");
    expect(f.te).toBe("高くて");
    expect(f.conditionalBa).toBe("高ければ");
  });
});

describe("getSurfaceForms", () => {
  it("includes dictionary form and conjugated forms for a verb", () => {
    const entry: VocabEntry = {
      id: "v-1",
      kanji: "帰る",
      yomi: "かえる",
      meaning: "回去",
      partOfSpeech: "verb",
      verb: { group: "godan-ru" },
    };
    const forms = getSurfaceForms(entry);
    expect(forms).toContain("帰る");
    expect(forms).toContain("帰って");
    expect(forms).toContain("帰ります");
  });

  it("returns just the dictionary form for a noun", () => {
    const entry: VocabEntry = {
      id: "v-2",
      kanji: "接続",
      yomi: "せつぞく",
      meaning: "连接",
      partOfSpeech: "noun",
    };
    expect(getSurfaceForms(entry)).toEqual(["接続"]);
  });
});
