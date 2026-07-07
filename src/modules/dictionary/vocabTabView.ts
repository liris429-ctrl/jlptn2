import type { JlptLevel, VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { el } from "../../utils/dom.ts";
import { isFavorite, subscribeFavorites } from "../favorites/favoritesStore.ts";
import { isWeak, subscribeWeak } from "../memorize/weakWordsStore.ts";
import { search } from "../search/searchIndex.ts";
import { renderVocabCard, renderVocabMemorizeCard } from "./entryCard.ts";

type LevelFilter = "all" | JlptLevel;
const LEVEL_OPTIONS: [LevelFilter, string][] = [
  ["all", "全部"],
  ["N1", "N1"],
  ["N2", "N2"],
  ["N3", "N3"],
  ["N4", "N4"],
  ["N5", "N5"],
];

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
  const weakToggle = el("button", { className: "chip filter-toggle", type: "button" }, [
    "只看弱點",
  ]);
  const memorizeToggle = el("button", { className: "chip filter-toggle", type: "button" }, [
    "暗記模式",
  ]);
  const resultsEl = el("div", { className: "search-results" });

  // Single-select, defaults to N2 - the vocab library now spans N1-N5, but this
  // app is still 「N2たん」at heart, so N2 stays the default lens unless the
  // user deliberately widens or narrows it.
  let level: LevelFilter = "N2";
  const levelButtons = new Map<LevelFilter, HTMLButtonElement>();
  const levelRow = el(
    "div",
    { className: "level-filter-row" },
    LEVEL_OPTIONS.map(([value, label]) => {
      const btn = el("button", { className: "chip filter-toggle", type: "button" }, [label]);
      btn.classList.toggle("filter-toggle--active", value === level);
      btn.addEventListener("click", () => {
        level = value;
        for (const [v, b] of levelButtons) b.classList.toggle("filter-toggle--active", v === level);
        renderResults();
      });
      levelButtons.set(value, btn);
      return btn;
    }),
  );

  container.append(
    el("div", { className: "search-page" }, [
      levelRow,
      el("div", { className: "search-controls" }, [input, favoritesToggle, weakToggle, memorizeToggle]),
      resultsEl,
    ]),
  );

  function filterByLevel(list: VocabEntry[]): VocabEntry[] {
    return level === "all" ? list : list.filter((v) => v.jlptLevel === level);
  }

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

  function renderEntry(entry: VocabEntry): HTMLElement {
    return memorizeMode ? renderVocabMemorizeCard(entry) : renderVocabCard(entry);
  }

  function renderResults(): void {
    resultsEl.innerHTML = "";
    const query = input.value.trim();

    if (!query) {
      if (!favoritesOnly && !weakOnly) {
        resultsEl.append(el("p", { className: "search-hint" }, ["輸入漢字、假名或中文開始查詢"]));
        return;
      }
      let list = filterByLevel(getStoreSync().vocab);
      if (favoritesOnly) list = list.filter((v) => isFavorite("vocab", v.id));
      if (weakOnly) list = list.filter((v) => isWeak("vocab", v.id));
      if (list.length === 0) {
        resultsEl.append(
          el("p", { className: "search-empty" }, [
            weakOnly
              ? "還沒有標記弱點，開啟暗記模式測驗幾個字後再回來看看"
              : "還沒有收藏，點列表旁的星星開始收藏吧",
          ]),
        );
        return;
      }
      for (const entry of list) resultsEl.append(renderEntry(entry));
      return;
    }

    const matches = search(query, { kind: "vocab" }).map((r) => r.entry as VocabEntry);
    let filtered = filterByLevel(matches);
    filtered = favoritesOnly ? filtered.filter((v) => isFavorite("vocab", v.id)) : filtered;
    filtered = weakOnly ? filtered.filter((v) => isWeak("vocab", v.id)) : filtered;
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
