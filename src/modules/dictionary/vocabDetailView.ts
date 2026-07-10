import type { ConjugatedForms, VocabExample, VocabRelatedWord } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { toRubyHtml } from "../../utils/furigana.ts";
import { touchWord } from "../today/srsStore.ts";
import { renderFavoriteToggle } from "./entryCard.ts";
import { POS_LABEL } from "./posLabels.ts";

const VERB_FORM_LABELS: [keyof ConjugatedForms, string][] = [
  ["masu", "ます形"],
  ["masuNegative", "ません形"],
  ["te", "て形"],
  ["ta", "た形"],
  ["nai", "ない形"],
  ["naiPast", "なかった形"],
  ["potential", "可能形"],
  ["volitional", "意向形"],
  ["passive", "受身形"],
  ["causative", "使役形"],
  ["imperative", "命令形"],
  ["conditionalBa", "条件形（ば）"],
];

const ADJECTIVE_FORM_LABELS: [keyof ConjugatedForms, string][] = [
  ["nai", "否定形（くない）"],
  ["ta", "過去形（かった）"],
  ["naiPast", "過去否定形（くなかった）"],
  ["te", "て形（くて）"],
  ["conditionalBa", "条件形（ければ）"],
];

export function renderVocabDetailView(container: HTMLElement, params: Record<string, string>): void {
  container.innerHTML = "";
  const store = getStoreSync();
  const entry = store.vocabById.get(params.id!);

  if (!entry) {
    container.append(renderNotFound());
    return;
  }

  // A detail-page visit is a weak "seen this" signal for the SRS system - only
  // seeds a schedule if this word has never been touched before.
  void touchWord("vocab", entry.id);

  const backBtn = el("button", { className: "back-button", type: "button" }, ["← 返回單字"]);
  backBtn.addEventListener("click", () => navigate("/vocab"));

  const headingText = el("h1", { className: "vocab-heading" });
  headingText.innerHTML = toRubyHtml(entry.kanji, entry.yomi);
  const headingRow = el("div", { className: "heading-row" }, [
    headingText,
    renderFavoriteToggle("vocab", entry.id, { large: true }),
  ]);

  const meta = el("div", { className: "vocab-meta" }, [
    el("span", { className: "jlpt-badge" }, [entry.jlptLevel]),
    el("span", { className: "pos-badge" }, [POS_LABEL[entry.partOfSpeech]]),
    ...(entry.pitchAccent ? [el("span", { className: "pitch-badge" }, [`アクセント: ${entry.pitchAccent.raw}`])] : []),
  ]);

  const meaning = el("p", { className: "vocab-meaning" }, [entry.meaning]);

  const sections: HTMLElement[] = [backBtn, headingRow, meta, meaning];

  if (entry.partOfSpeech === "verb" && entry.verb?.conjugatedForms) {
    sections.push(renderFormsTable("動詞変化", VERB_FORM_LABELS, entry.verb.conjugatedForms));
  } else if (entry.partOfSpeech === "i-adjective" && entry.adjectiveForms) {
    sections.push(renderFormsTable("形容詞変化", ADJECTIVE_FORM_LABELS, entry.adjectiveForms));
  }

  if (entry.examples && entry.examples.length > 0) {
    sections.push(renderVocabExamples(entry.examples));
  }

  if (entry.relatedWords && entry.relatedWords.length > 0) {
    sections.push(renderRelatedWords(entry.relatedWords));
  }

  if (entry.grammarRefs && entry.grammarRefs.length > 0) {
    sections.push(renderGrammarRefs(entry.grammarRefs, store));
  }

  container.append(el("div", { className: "detail-page vocab-detail" }, sections));
}

function renderVocabExamples(examples: VocabExample[]): HTMLElement {
  const cards = examples.map((example) => {
    const sentence = el("p", { className: "example-jp" });
    sentence.innerHTML = example.furiganaRuby || example.jp;
    return el("div", { className: "example-card" }, [
      sentence,
      el("p", { className: "example-cn" }, [example.cn]),
    ]);
  });
  return el("section", { className: "examples-section" }, [el("h2", {}, ["例句"]), ...cards]);
}

function renderRelatedWords(relatedWords: VocabRelatedWord[]): HTMLElement {
  const groups: [label: string, words: VocabRelatedWord[]][] = [
    ["同義詞", relatedWords.filter((w) => w.relation === "related")],
    ["反義詞", relatedWords.filter((w) => w.relation === "antonym")],
  ];
  const rows = groups
    .filter(([, words]) => words.length > 0)
    .map(([label, words]) => {
      const chips = words.map((w) => {
        const chip = el("span", { className: "chip chip--grammar" });
        chip.innerHTML = w.furiganaRuby || w.kanji;
        return chip;
      });
      return el("div", { className: "related-word-row" }, [
        el("span", { className: "related-word-label" }, [`${label}：`]),
        el("div", { className: "chip-row" }, chips),
      ]);
    });
  return el("section", { className: "related-words-section" }, [el("h2", {}, ["相關詞"]), ...rows]);
}

function renderFormsTable(
  title: string,
  labels: [keyof ConjugatedForms, string][],
  forms: Partial<ConjugatedForms>,
): HTMLElement {
  const rows = labels
    .filter(([key]) => forms[key])
    .map(([key, label]) =>
      el("div", { className: "form-row" }, [
        el("span", { className: "form-label" }, [label]),
        el("span", { className: "form-value" }, [forms[key]!]),
      ]),
    );
  return el("section", { className: "forms-section" }, [
    el("h2", {}, [title]),
    el("div", { className: "forms-table" }, rows),
  ]);
}

function renderGrammarRefs(
  grammarIds: string[],
  store: ReturnType<typeof getStoreSync>,
): HTMLElement {
  const chips = grammarIds
    .map((id) => store.grammarById.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((g) => {
      const chip = el("button", { className: "chip chip--grammar", type: "button" }, [g.pattern]);
      chip.addEventListener("click", () => navigate(`/grammar/${g.id}`));
      return chip;
    });
  return el("section", { className: "grammar-refs-section" }, [
    el("h2", {}, ["出現於以下文法"]),
    el("div", { className: "chip-row" }, chips),
  ]);
}

function renderNotFound(): HTMLElement {
  const back = el("button", { className: "back-button", type: "button" }, ["← 返回單字"]);
  back.addEventListener("click", () => navigate("/vocab"));
  return el("div", { className: "detail-page" }, [back, el("p", {}, ["找不到這個單字"])]);
}
