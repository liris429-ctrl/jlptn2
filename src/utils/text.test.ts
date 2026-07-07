import { describe, expect, it } from "vitest";
import { firstClause } from "./text.ts";

describe("firstClause", () => {
  it("returns the text before a fullwidth comma (，) - the dominant separator in the data", () => {
    expect(firstClause("每个人，各自")).toBe("每个人");
  });

  it("returns the text before an ideographic comma (、)", () => {
    expect(firstClause("获得帮助、得救")).toBe("获得帮助");
  });

  it("returns the text before a fullwidth semicolon (；)", () => {
    expect(firstClause("难受；艰苦；为难")).toBe("难受");
  });

  it("returns the text before an ASCII semicolon", () => {
    expect(firstClause("获得帮助;得救")).toBe("获得帮助");
  });

  it("returns the whole string when there is no separator", () => {
    expect(firstClause("时刻")).toBe("时刻");
  });
});
