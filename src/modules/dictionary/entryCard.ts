import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { isFavorite, toggleFavorite } from "../favorites/favoritesStore.ts";
import { toRubyHtml } from "../../utils/furigana.ts";
import { POS_LABEL_SHORT } from "./posLabels.ts";

export function renderFavoriteToggle(
  kind: FavoriteKind,
  id: string,
  { large = false }: { large?: boolean } = {},
): HTMLElement {
  const btn = el("button", {
    className: large ? "favorite-toggle favorite-toggle--lg" : "favorite-toggle",
    type: "button",
    "aria-label": "收藏",
  });
  const sync = (): void => {
    // U+FE0E forces the text (monochrome) glyph presentation instead of a
    // platform's built-in full-color emoji star, which would ignore CSS `color`.
    btn.textContent = isFavorite(kind, id) ? "★︎" : "☆︎";
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
  const primary = el("span", { className: "result-primary" });
  primary.innerHTML = toRubyHtml(entry.kanji, entry.yomi);
  const primaryRow = el("span", { className: "result-primary-row" }, [
    primary,
    el("span", { className: "result-pos" }, [POS_LABEL_SHORT[entry.partOfSpeech]]),
  ]);
  return makeCardShell(
    "result-card result-card--vocab",
    () => navigate(`/vocab/${entry.id}`),
    [
      el("span", { className: "result-kind" }, ["單字"]),
      primaryRow,
      el("span", { className: "result-meaning" }, [entry.meaning]),
      renderFavoriteToggle("vocab", entry.id),
    ],
  );
}
