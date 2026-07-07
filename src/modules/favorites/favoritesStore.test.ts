import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetFavoritesForTest,
  isFavorite,
  listFavoriteIds,
  subscribeFavorites,
  toggleFavorite,
} from "./favoritesStore.ts";

describe("favoritesStore", () => {
  beforeEach(() => _resetFavoritesForTest());

  it("starts with nothing favorited", () => {
    expect(isFavorite("grammar", "g-1")).toBe(false);
    expect(listFavoriteIds("grammar")).toEqual([]);
  });

  it("toggling adds then removes a favorite", () => {
    toggleFavorite("grammar", "g-1");
    expect(isFavorite("grammar", "g-1")).toBe(true);
    toggleFavorite("grammar", "g-1");
    expect(isFavorite("grammar", "g-1")).toBe(false);
  });

  it("keeps grammar and vocab favorites separate even with the same id", () => {
    toggleFavorite("grammar", "same-id");
    expect(isFavorite("grammar", "same-id")).toBe(true);
    expect(isFavorite("vocab", "same-id")).toBe(false);
  });

  it("listFavoriteIds only returns ids for the requested kind", () => {
    toggleFavorite("grammar", "g-1");
    toggleFavorite("vocab", "v-1");
    toggleFavorite("vocab", "v-2");
    expect(listFavoriteIds("grammar")).toEqual(["g-1"]);
    expect(listFavoriteIds("vocab").sort()).toEqual(["v-1", "v-2"]);
  });

  it("notifies subscribers on every toggle", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFavorites(listener);
    toggleFavorite("grammar", "g-1");
    toggleFavorite("grammar", "g-1");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toggleFavorite("grammar", "g-1");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
