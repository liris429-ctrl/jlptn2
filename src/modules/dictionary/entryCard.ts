import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { isFavorite, toggleFavorite } from "../favorites/favoritesStore.ts";

export function renderFavoriteToggle(kind: FavoriteKind, id: string): HTMLElement {
  const btn = el("button", {
    className: "favorite-toggle",
    type: "button",
    "aria-label": "收藏",
  });
  const sync = (): void => {
    btn.textContent = isFavorite(kind, id) ? "★" : "☆";
    btn.classList.toggle("favorite-toggle--active", isFavorite(kind, id));
  };
  sync();
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(kind, id);
    sync();
  });
  return btn;
}

/**
 * Card wrapper is a div (not a button) with button semantics via role/tabindex,
 * because it needs to contain a real nested <button> for the favorite toggle -
 * and a <button> can't legally contain another <button>.
 */
function makeCardShell(className: string, onActivate: () => void, children: (Node | string)[]): HTMLElement {
  const card = el(
    "div",
    { className, role: "button", tabindex: "0" },
    children,
  );
  card.addEventListener("click", onActivate);
  card.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  });
  return card;
}

export function renderGrammarCard(entry: GrammarEntry): HTMLElement {
  return makeCardShell(
    "result-card result-card--grammar",
    () => navigate(`/grammar/${entry.id}`),
    [
      el("span", { className: "result-kind" }, ["文法"]),
      el("span", { className: "result-primary" }, [entry.pattern]),
      el("span", { className: "result-meaning" }, [entry.meaning]),
      renderFavoriteToggle("grammar", entry.id),
    ],
  );
}

export function renderVocabCard(entry: VocabEntry): HTMLElement {
  return makeCardShell(
    "result-card result-card--vocab",
    () => navigate(`/vocab/${entry.id}`),
    [
      el("span", { className: "result-kind" }, ["單字"]),
      el("span", { className: "result-primary" }, [entry.kanji]),
      el("span", { className: "result-yomi" }, [entry.yomi]),
      el("span", { className: "result-meaning" }, [entry.meaning]),
      renderFavoriteToggle("vocab", entry.id),
    ],
  );
}
