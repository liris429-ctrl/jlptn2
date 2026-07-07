import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetWeakForTest,
  clearWeak,
  isWeak,
  listWeakIds,
  markWeak,
  subscribeWeak,
} from "./weakWordsStore.ts";

describe("weakWordsStore", () => {
  beforeEach(() => _resetWeakForTest());

  it("starts with nothing marked weak", () => {
    expect(isWeak("grammar", "g-1")).toBe(false);
    expect(listWeakIds("grammar")).toEqual([]);
  });

  it("markWeak then clearWeak adds then removes an entry", () => {
    markWeak("grammar", "g-1");
    expect(isWeak("grammar", "g-1")).toBe(true);
    clearWeak("grammar", "g-1");
    expect(isWeak("grammar", "g-1")).toBe(false);
  });

  it("keeps grammar and vocab weak marks separate even with the same id", () => {
    markWeak("grammar", "same-id");
    expect(isWeak("grammar", "same-id")).toBe(true);
    expect(isWeak("vocab", "same-id")).toBe(false);
  });

  it("listWeakIds only returns ids for the requested kind", () => {
    markWeak("grammar", "g-1");
    markWeak("vocab", "v-1");
    markWeak("vocab", "v-2");
    expect(listWeakIds("grammar")).toEqual(["g-1"]);
    expect(listWeakIds("vocab").sort()).toEqual(["v-1", "v-2"]);
  });

  it("notifies subscribers on every markWeak/clearWeak", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWeak(listener);
    markWeak("grammar", "g-1");
    clearWeak("grammar", "g-1");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    markWeak("grammar", "g-1");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
