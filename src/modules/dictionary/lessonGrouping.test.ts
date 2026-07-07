import { describe, expect, it } from "vitest";
import type { GrammarEntry } from "../../data/schema.ts";
import { groupByLesson } from "./lessonGrouping.ts";

function entry(id: string, lesson?: string): GrammarEntry {
  return {
    id,
    pattern: `pattern-${id}`,
    conjunctionRules: "",
    meaning: "",
    examples: [],
    lesson,
  };
}

describe("groupByLesson", () => {
  it("groups entries under the same lesson number regardless of sub-index", () => {
    const groups = groupByLesson([
      entry("a", "第1課 - 1"),
      entry("b", "第1課 - 2"),
      entry("c", "第2課 - 1"),
    ]);
    expect(groups.map((g) => g.lessonLabel)).toEqual(["第1課", "第2課"]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("sorts lessons numerically, not lexicographically (第10課 after 第2課)", () => {
    const groups = groupByLesson([entry("a", "第10課 - 1"), entry("b", "第2課 - 1")]);
    expect(groups.map((g) => g.lessonLabel)).toEqual(["第2課", "第10課"]);
  });

  it("puts entries with no parseable lesson into a trailing 其他 bucket", () => {
    const groups = groupByLesson([entry("a", "第1課 - 1"), entry("b", undefined), entry("c", "不明")]);
    expect(groups.at(-1)!.lessonLabel).toBe("其他");
    expect(groups.at(-1)!.entries.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("returns an empty array for no entries", () => {
    expect(groupByLesson([])).toEqual([]);
  });
});
