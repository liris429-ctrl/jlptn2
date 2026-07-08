import { describe, expect, it } from "vitest";
import { computeVisibleRange } from "./virtualList.ts";

describe("computeVisibleRange", () => {
  it("returns [0, 0] for an empty list", () => {
    expect(computeVisibleRange(0, 500, 50, 0, 6)).toEqual([0, 0]);
  });

  it("includes overscan above and below the visible window", () => {
    const [start, end] = computeVisibleRange(1000, 500, 50, 1000, 6);
    // scrollTop 1000 / itemHeight 50 = row 20, minus overscan 6 = 14.
    expect(start).toBe(14);
    // visible rows = ceil(500/50) = 10, plus overscan*2 = 12 -> 22-row window.
    expect(end).toBe(36);
  });

  it("clamps the start index to 0 near the top", () => {
    const [start] = computeVisibleRange(0, 500, 50, 1000, 6);
    expect(start).toBe(0);
  });

  it("clamps the end index to the total item count near the bottom", () => {
    const [, end] = computeVisibleRange(9800, 500, 50, 200, 6);
    expect(end).toBe(200);
  });
});
