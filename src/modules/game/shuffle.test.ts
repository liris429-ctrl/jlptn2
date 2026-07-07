import { describe, expect, it } from "vitest";
import { sample, shuffle } from "./shuffle.ts";

describe("shuffle", () => {
  it("returns the same elements in some order", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result).toHaveLength(5);
    expect([...result].sort()).toEqual(input);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];
    shuffle(input);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe("sample", () => {
  it("returns the requested count of unique elements", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const result = sample(input, 8);
    expect(result).toHaveLength(8);
    expect(new Set(result).size).toBe(8);
    for (const v of result) expect(input).toContain(v);
  });
});
