import type { VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { el } from "../../utils/dom.ts";
import { isFavorite, subscribeFavorites } from "../favorites/favoritesStore.ts";
import { search } from "../search/searchIndex.ts";
import { renderVocabCard } from "./entryCard.ts";

export function renderVocabTabView(container: HTMLElement): void {
  container.innerHTML = "";

  const input = el("input", {
    type: "search",
    className: "search-input",
    placeholder: "查詢單字（漢字・假名・中文皆可）",
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

  function renderResults(): void {
    resultsEl.innerHTML = "";
    const query = input.value.trim();

    if (!query) {
      if (!favoritesOnly) {
        resultsEl.append(el("p", { className: "search-hint" }, ["輸入漢字、假名或中文開始查詢"]));
        return;
      }
      const favorited = getStoreSync().vocab.filter((v) => isFavorite("vocab", v.id));
      if (favorited.length === 0) {
        resultsEl.append(
          el("p", { className: "search-empty" }, ["還沒有收藏，點列表旁的星星開始收藏吧"]),
        );
        return;
      }
      for (const entry of favorited) resultsEl.append(renderVocabCard(entry));
      return;
    }

    const matches = search(query, { kind: "vocab" }).map((r) => r.entry as VocabEntry);
    const filtered = favoritesOnly ? matches.filter((v) => isFavorite("vocab", v.id)) : matches;
    if (filtered.length === 0) {
      resultsEl.append(
        el("p", { className: "search-empty" }, [`找不到「${query}」，試試看用假名或中文查詢？`]),
      );
      return;
    }
    for (const entry of filtered) resultsEl.append(renderVocabCard(entry));
  }

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(renderResults, 180);
  });
  renderResults();
  input.focus();
}
