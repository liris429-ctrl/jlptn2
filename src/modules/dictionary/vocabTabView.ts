import type { JlptLevel, VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { el } from "../../utils/dom.ts";
import { compareYomi } from "../../utils/kana.ts";
import { renderVirtualList, type VirtualListHandle } from "../../utils/virtualList.ts";
import { isFavorite, subscribeFavorites } from "../favorites/favoritesStore.ts";
import { isWeak, subscribeWeak } from "../memorize/weakWordsStore.ts";
import { search } from "../search/searchIndex.ts";
import { renderVocabCard, renderVocabMemorizeCard } from "./entryCard.ts";

// Mirrors --space-3 (0.75rem, 16px root): the virtual list positions rows with
// `transform` instead of flexbox `gap`, so it needs the same spacing as a literal.
const RESULT_GAP_PX = 12;

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
    placeholder: "查詢",
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

  // Single-select, defaults to "all" - browsing opens straight onto the full
  // library; narrowing to one JLPT level is an opt-in, not the starting point.
  let level: LevelFilter = "all";
  const levelButtons = new Map<LevelFilter, HTMLButtonElement>();
  const levelRow = el(
    "div",
    { className: "level-filter-row" },
    LEVEL_OPTIONS.map(([value, label]) => {
      const btn = el("button", { className: "level-segment", type: "button" }, [label]);
      btn.classList.toggle("level-segment--active", value === level);
      btn.addEventListener("click", () => {
        level = value;
        for (const [v, b] of levelButtons) b.classList.toggle("level-segment--active", v === level);
        renderResults();
      });
      levelButtons.set(value, btn);
      return btn;
    }),
  );

  container.append(
    el("div", { className: "search-page" }, [
      levelRow,
      input,
      el("div", { className: "search-controls" }, [favoritesToggle, weakToggle, memorizeToggle]),
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
      virtualList?.destroy();
    },
    { once: true },
  );

  function renderEntry(entry: VocabEntry): HTMLElement {
    return memorizeMode ? renderVocabMemorizeCard(entry) : renderVocabCard(entry);
  }

  // Torn down at the start of every renderResults() call - without this, each
  // re-render would leave the previous call's scroll listener attached to
  // resultsEl (it's never replaced, only its children are).
  let virtualList: VirtualListHandle | null = null;

  // Bumped on every renderList() call so an in-flight chunked memorize-mode
  // append (see below) can tell it's been superseded and stop instead of
  // piling stale cards into a list the user has already navigated away from.
  let renderToken = 0;

  function renderList(list: VocabEntry[]): void {
    virtualList?.destroy();
    virtualList = null;
    resultsEl.innerHTML = "";
    const token = ++renderToken;
    if (memorizeMode) {
      // 暗記模式 cards hold local "revealed" state in a closure; recycling them
      // via the virtual list would reset that state every time a card scrolls
      // out of view and back in. Sessions here are normally scoped to a small
      // list (favorites/weak), but the level filter defaults to 全部, so this
      // can still mean 10,000+ cards - append in chunks across animation
      // frames instead of one blocking loop, so the tab doesn't freeze while
      // every card in it stays a real, always-in-DOM element.
      let i = 0;
      const step = (): void => {
        if (token !== renderToken) return;
        const end = Math.min(i + 200, list.length);
        const fragment = document.createDocumentFragment();
        for (; i < end; i++) fragment.append(renderEntry(list[i]!));
        resultsEl.append(fragment);
        if (i < list.length) requestAnimationFrame(step);
      };
      step();
    } else {
      virtualList = renderVirtualList(resultsEl, list, renderEntry, RESULT_GAP_PX);
    }
  }

  function renderResults(): void {
    const query = input.value.trim();

    if (!query) {
      let list = filterByLevel(getStoreSync().vocab);
      if (favoritesOnly) list = list.filter((v) => isFavorite("vocab", v.id));
      if (weakOnly) list = list.filter((v) => isWeak("vocab", v.id));
      if (list.length === 0) {
        virtualList?.destroy();
        virtualList = null;
        resultsEl.innerHTML = "";
        resultsEl.append(
          el("p", { className: "search-empty" }, [
            weakOnly
              ? "還沒有標記弱點，開啟暗記模式測驗幾個字後再回來看看"
              : "還沒有收藏，點列表旁的星星開始收藏吧",
          ]),
        );
        return;
      }
      list = [...list].sort((a, b) => compareYomi(a.yomi, b.yomi));
      renderList(list);
      return;
    }

    const matches = search(query, { kind: "vocab" }).map((r) => r.entry as VocabEntry);
    let filtered = filterByLevel(matches);
    filtered = favoritesOnly ? filtered.filter((v) => isFavorite("vocab", v.id)) : filtered;
    filtered = weakOnly ? filtered.filter((v) => isWeak("vocab", v.id)) : filtered;
    if (filtered.length === 0) {
      virtualList?.destroy();
      virtualList = null;
      resultsEl.innerHTML = "";
      resultsEl.append(
        el("p", { className: "search-empty" }, [`找不到「${query}」，試試看用假名或中文查詢？`]),
      );
      return;
    }
    renderList(filtered);
  }

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(renderResults, 180);
  });
  renderResults();
  input.focus();
}
