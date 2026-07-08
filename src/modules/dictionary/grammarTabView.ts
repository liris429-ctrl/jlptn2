import type { GrammarEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { el } from "../../utils/dom.ts";
import { isFavorite, subscribeFavorites } from "../favorites/favoritesStore.ts";
import { isWeak, subscribeWeak } from "../memorize/weakWordsStore.ts";
import { search } from "../search/searchIndex.ts";
import { renderGrammarCard, renderGrammarMemorizeCard } from "./entryCard.ts";
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
  const weakToggle = el("button", { className: "chip filter-toggle", type: "button" }, [
    "只看弱點",
  ]);
  const memorizeToggle = el("button", { className: "chip filter-toggle", type: "button" }, [
    "暗記模式",
  ]);
  const resultsEl = el("div", { className: "search-results" });
  container.append(
    el("div", { className: "search-page" }, [
      input,
      el("div", { className: "search-controls" }, [favoritesToggle, weakToggle, memorizeToggle]),
      resultsEl,
    ]),
  );

  let favoritesOnly = false;
  favoritesToggle.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    favoritesToggle.classList.toggle("filter-toggle--active", favoritesOnly);
    renderResults();
  });

  let weakOnly = false;
  weakToggle.addEventListener("click", () => {
    weakOnly = !weakOnly;
    weakToggle.classList.toggle("filter-toggle--active", weakOnly);
    renderResults();
  });

  let memorizeMode = false;
  memorizeToggle.addEventListener("click", () => {
    memorizeMode = !memorizeMode;
    memorizeToggle.classList.toggle("filter-toggle--active", memorizeMode);
    renderResults();
  });

  const unsubscribeFavorites = subscribeFavorites(() => {
    if (favoritesOnly) renderResults();
  });
  const unsubscribeWeak = subscribeWeak(() => {
    if (weakOnly) renderResults();
  });
  window.addEventListener(
    "hashchange",
    () => {
      unsubscribeFavorites();
      unsubscribeWeak();
    },
    { once: true },
  );

  function applyFilters(entries: GrammarEntry[]): GrammarEntry[] {
    let filtered = favoritesOnly ? entries.filter((e) => isFavorite("grammar", e.id)) : entries;
    filtered = weakOnly ? filtered.filter((e) => isWeak("grammar", e.id)) : filtered;
    return filtered;
  }

  function renderEntry(entry: GrammarEntry): HTMLElement {
    return memorizeMode ? renderGrammarMemorizeCard(entry) : renderGrammarCard(entry);
  }

  function renderResults(): void {
    resultsEl.innerHTML = "";
    const query = input.value.trim();

    if (!query) {
      const filtered = applyFilters(getStoreSync().grammar);
      if (filtered.length === 0) {
        resultsEl.append(
          el("p", { className: "search-empty" }, [
            weakOnly
              ? "還沒有標記弱點，開啟暗記模式測驗幾個字後再回來看看"
              : "還沒有收藏，點列表旁的星星開始收藏吧",
          ]),
        );
        return;
      }
      for (const group of groupByLesson(filtered)) {
        resultsEl.append(el("h2", { className: "lesson-heading" }, [group.lessonLabel]));
        for (const entry of group.entries) resultsEl.append(renderEntry(entry));
      }
      return;
    }

    const matches = search(query, { kind: "grammar" }).map((r) => r.entry as GrammarEntry);
    const filtered = applyFilters(matches);
    if (filtered.length === 0) {
      resultsEl.append(
        el("p", { className: "search-empty" }, [`找不到「${query}」，試試看用假名或中文查詢？`]),
      );
      return;
    }
    for (const entry of filtered) resultsEl.append(renderEntry(entry));
  }

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(renderResults, 180);
  });
  renderResults();
  input.focus();
}
