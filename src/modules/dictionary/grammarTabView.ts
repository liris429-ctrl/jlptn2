import type { GrammarEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { el } from "../../utils/dom.ts";
import { isFavorite, subscribeFavorites } from "../favorites/favoritesStore.ts";
import { search } from "../search/searchIndex.ts";
import { renderGrammarCard } from "./entryCard.ts";
import { groupByLesson } from "./lessonGrouping.ts";

export function renderGrammarTabView(container: HTMLElement): void {
  container.innerHTML = "";

  const input = el("input", {
    type: "search",
    className: "search-input",
    placeholder: "查詢文法（漢字・假名・中文皆可）",
    autofocus: "true",
  });
  const favoritesToggle = el("button", { className: "chip filter-toggle", type: "button" }, [
    "只看收藏",
  ]);
  const resultsEl = el("div", { className: "search-results" });
  container.append(
    el("div", { className: "search-page" }, [
      el("div", { className: "search-controls" }, [input, favoritesToggle]),
      resultsEl,
    ]),
  );

  let favoritesOnly = false;
  favoritesToggle.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    favoritesToggle.classList.toggle("filter-toggle--active", favoritesOnly);
    renderResults();
  });

  const unsubscribe = subscribeFavorites(() => {
    if (favoritesOnly) renderResults();
  });
  window.addEventListener("hashchange", unsubscribe, { once: true });

  function applyFavoritesFilter(entries: GrammarEntry[]): GrammarEntry[] {
    return favoritesOnly ? entries.filter((e) => isFavorite("grammar", e.id)) : entries;
  }

  function renderResults(): void {
    resultsEl.innerHTML = "";
    const query = input.value.trim();

    if (!query) {
      const filtered = applyFavoritesFilter(getStoreSync().grammar);
      if (filtered.length === 0) {
        resultsEl.append(
          el("p", { className: "search-empty" }, ["還沒有收藏，點列表旁的星星開始收藏吧"]),
        );
        return;
      }
      for (const group of groupByLesson(filtered)) {
        resultsEl.append(el("h2", { className: "lesson-heading" }, [group.lessonLabel]));
        for (const entry of group.entries) resultsEl.append(renderGrammarCard(entry));
      }
      return;
    }

    const matches = search(query, { kind: "grammar" }).map((r) => r.entry as GrammarEntry);
    const filtered = applyFavoritesFilter(matches);
    if (filtered.length === 0) {
      resultsEl.append(
        el("p", { className: "search-empty" }, [`找不到「${query}」，試試看用假名或中文查詢？`]),
      );
      return;
    }
    for (const entry of filtered) resultsEl.append(renderGrammarCard(entry));
  }

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(renderResults, 180);
  });
  renderResults();
  input.focus();
}
