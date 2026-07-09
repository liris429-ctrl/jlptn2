import type { GrammarEntry, VocabEntry } from "../../data/schema.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import { isFavorite, toggleFavorite } from "../favorites/favoritesStore.ts";
import { clearWeak, markWeak } from "../memorize/weakWordsStore.ts";
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

/** Tier 3 "control" cluster: JLPT level + favorite toggle, grouped apart from the word/meaning content. */
function buildVocabControls(entry: VocabEntry): HTMLElement {
  return el("span", { className: "result-control" }, [
    el("span", { className: "result-level" }, [entry.jlptLevel]),
    renderFavoriteToggle("vocab", entry.id),
  ]);
}

/** Tier 2 "secondary" row content shared by the plain and 暗記模式 cards: reading + part-of-speech tag. */
function buildVocabSecondaryPrefix(entry: VocabEntry): HTMLElement[] {
  return [
    el("span", { className: "result-yomi" }, [entry.yomi]),
    el("span", { className: "result-pos" }, [POS_LABEL_SHORT[entry.partOfSpeech]]),
  ];
}

export function renderVocabCard(entry: VocabEntry): HTMLElement {
  return makeCardShell(
    "result-card result-card--vocab",
    () => navigate(`/vocab/${entry.id}`),
    [
      el("span", { className: "result-kind" }, ["單字"]),
      el("span", { className: "result-primary" }, [entry.kanji]),
      el("span", { className: "result-secondary" }, [
        ...buildVocabSecondaryPrefix(entry),
        el("span", { className: "result-meaning" }, [entry.meaning]),
      ]),
      buildVocabControls(entry),
    ],
  );
}

export function renderGrammarMemorizeCard(entry: GrammarEntry): HTMLElement {
  return renderMemorizeCard({
    kind: "grammar",
    id: entry.id,
    kindLabel: "文法",
    primary: el("span", { className: "result-primary" }, [entry.pattern]),
    secondaryPrefix: [],
    controls: renderFavoriteToggle("grammar", entry.id),
    meaning: entry.meaning,
  });
}

export function renderVocabMemorizeCard(entry: VocabEntry): HTMLElement {
  return renderMemorizeCard({
    kind: "vocab",
    id: entry.id,
    kindLabel: "單字",
    primary: el("span", { className: "result-primary" }, [entry.kanji]),
    secondaryPrefix: buildVocabSecondaryPrefix(entry),
    controls: buildVocabControls(entry),
    meaning: entry.meaning,
  });
}

/**
 * 赤シート-style self-test card: the meaning starts hidden behind a gray block
 * (tap to reveal), then offers 記得/忘了 feedback that feeds weakWordsStore. Not
 * built on makeCardShell - the whole-card "tap navigates to detail" gesture would
 * collide with "tap the block to reveal the answer", so this card isn't navigable
 * at all while 暗記模式 is on.
 */
function renderMemorizeCard(opts: {
  kind: FavoriteKind;
  id: string;
  kindLabel: string;
  primary: HTMLElement;
  secondaryPrefix: HTMLElement[];
  controls: HTMLElement;
  meaning: string;
}): HTMLElement {
  const { kind, id, kindLabel, primary, secondaryPrefix, meaning, controls } = opts;

  const occludeBtn = el("button", {
    className: "occlude-block",
    type: "button",
    "aria-label": "點一下顯示答案",
  });
  occludeBtn.style.width = `${Math.min(Math.max(meaning.length, 4), 12)}ch`;

  const answerRow = el("div", { className: "occlude-row" }, [occludeBtn]);

  occludeBtn.addEventListener("click", () => {
    const rememberBtn = el(
      "button",
      { className: "occlude-btn occlude-btn--remember", type: "button" },
      ["✓ 記得"],
    );
    const forgetBtn = el(
      "button",
      { className: "occlude-btn occlude-btn--forget", type: "button" },
      ["✗ 忘了"],
    );
    const feedbackRow = el("div", { className: "occlude-feedback" }, [rememberBtn, forgetBtn]);

    rememberBtn.addEventListener("click", () => {
      clearWeak(kind, id);
      feedbackRow.innerHTML = "";
      feedbackRow.append(el("span", { className: "occlude-status" }, ["已標記：記得"]));
    });
    forgetBtn.addEventListener("click", () => {
      markWeak(kind, id);
      feedbackRow.innerHTML = "";
      feedbackRow.append(el("span", { className: "occlude-status" }, ["已標記：忘了"]));
    });

    answerRow.innerHTML = "";
    answerRow.append(el("span", { className: "result-meaning" }, [meaning]), feedbackRow);
  });

  return el("div", { className: "result-card result-card--memorize" }, [
    el("span", { className: "result-kind" }, [kindLabel]),
    primary,
    el("div", { className: "result-secondary" }, [...secondaryPrefix, answerRow]),
    controls,
  ]);
}
