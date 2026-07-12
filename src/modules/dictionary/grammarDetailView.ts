import type { GrammarEntry, GrammarExample } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { renderFavoriteToggle, renderMarkLearnedButton } from "./entryCard.ts";
import { linkedVocabChips } from "./renderLinkedSentence.ts";

const SENSE_LABELS = ["用法一", "用法二", "用法三", "用法四", "用法五"];

export function renderGrammarDetailView(
  container: HTMLElement,
  params: Record<string, string>,
): void {
  container.innerHTML = "";
  const store = getStoreSync();
  const entry = store.grammarById.get(params.id!);

  if (!entry) {
    const back = el("button", { className: "back-button", type: "button" }, ["← 返回文法"]);
    back.addEventListener("click", () => navigate("/grammar"));
    container.append(el("div", { className: "detail-page" }, [back, el("p", {}, ["找不到這個文法"])]));
    return;
  }

  const backBtn = el("button", { className: "back-button", type: "button" }, ["← 返回文法"]);
  backBtn.addEventListener("click", () => navigate("/grammar"));

  const headingRow = el("div", { className: "heading-row" }, [
    el("h1", { className: "grammar-heading" }, [entry.pattern]),
    renderFavoriteToggle("grammar", entry.id, { large: true }),
  ]);

  // Multi-sense entries (senses.length > 1, e.g. さえ's "even X" vs "as long
  // as X" senses taught under separate lesson sub-groups) replace the single
  // meaning paragraph + flat example list with one card per sense instead -
  // otherwise there's no way to tell which example demonstrates which
  // usage. Single-sense entries (the vast majority) are untouched.
  const isMultiSense = entry.senses.length > 1;

  const sections: HTMLElement[] = [backBtn, headingRow];
  if (!isMultiSense) {
    sections.push(el("p", { className: "grammar-meaning" }, [entry.meaning]));
  }
  sections.push(renderMarkLearnedButton("grammar", entry.id));

  // Conjunction rules are one shared block regardless of sense count - they
  // describe how the pattern attaches grammatically, not which meaning it
  // carries, so there's no per-sense variant to split them into.
  if (entry.conjunctionRulesHtml || entry.conjunctionRules) {
    const box = el("div", { className: "conjunction-box" });
    box.innerHTML = entry.conjunctionRulesHtml ?? entry.conjunctionRules;
    sections.push(el("section", { className: "conjunction-section" }, [el("h2", {}, ["接続"]), box]));
  }

  if (isMultiSense) {
    sections.push(renderSenses(entry, store));
  }

  if (entry.explanationJa) {
    const details = el("details", { className: "explanation-ja" });
    details.append(el("summary", {}, ["日本語での説明"]), el("p", {}, [entry.explanationJa]));
    sections.push(details);
  }

  if (!isMultiSense && entry.examples.length > 0) {
    sections.push(
      el("section", { className: "examples-section" }, [
        el("h2", {}, ["例句"]),
        ...entry.examples.map((ex) => renderExample(ex, store)),
      ]),
    );
  }

  if (entry.additionalNotes && entry.additionalNotes.length > 0) {
    sections.push(renderAdditionalNotes(entry.additionalNotes));
  }

  container.append(el("div", { className: "detail-page grammar-detail" }, sections));
}

/** One visually-distinct card per sense - accent-badged "用法一/用法二/..."
 * label, its own definition, and only the examples that demonstrate it
 * (sense.exampleIds), so a multi-sense point never reads as "one meaning,
 * one grab-bag of examples" the way the single-sense layout would. */
function renderSenses(entry: GrammarEntry, store: ReturnType<typeof getStoreSync>): HTMLElement {
  const examplesById = new Map(entry.examples.map((ex) => [ex.id, ex]));
  const cards = entry.senses.map((sense, i) => {
    const examples = sense.exampleIds
      .map((exId) => examplesById.get(exId))
      .filter((ex): ex is GrammarExample => ex != null);
    return el("div", { className: "sense-card" }, [
      el("span", { className: "sense-badge" }, [SENSE_LABELS[i] ?? `用法${i + 1}`]),
      el("p", { className: "sense-text" }, [sense.text]),
      el(
        "div",
        { className: "sense-examples" },
        examples.map((ex) => renderExample(ex, store)),
      ),
    ]);
  });
  return el("section", { className: "grammar-senses" }, cards);
}

function renderExample(example: GrammarExample, store: ReturnType<typeof getStoreSync>): HTMLElement {
  const sentence = el("p", { className: "example-jp" });
  sentence.innerHTML = example.furiganaRuby || example.jp;

  const translation = el("p", { className: "example-cn" }, [example.cn]);

  const parts: HTMLElement[] = [sentence, translation];

  const chips = linkedVocabChips(example, store.vocabById);
  if (chips.length > 0) {
    const chipRow = el(
      "div",
      { className: "chip-row" },
      chips.map((chip) => {
        const btn = el("button", { className: "chip chip--vocab", type: "button" }, [
          `${chip.kanji} ${chip.yomi}`,
        ]);
        btn.addEventListener("click", () => navigate(`/vocab/${chip.vocabId}`));
        return btn;
      }),
    );
    parts.push(chipRow);
  }

  if (example.detailedExplanationHtml) {
    const details = el("details", { className: "detailed-explanation" });
    const body = el("div", { className: "detailed-explanation-body" });
    body.innerHTML = example.detailedExplanationHtml;
    details.append(el("summary", {}, ["逐詞精解"]), body);
    parts.push(details);
  }

  return el("div", { className: "example-card" }, parts);
}

function renderAdditionalNotes(
  notes: NonNullable<import("../../data/schema.ts").GrammarEntry["additionalNotes"]>,
): HTMLElement {
  const items = notes.map((note) => {
    const jaLine = note.relatedGrammarId
      ? (() => {
          const btn = el("button", { className: "chip chip--grammar", type: "button" }, [note.textJa]);
          btn.addEventListener("click", () => navigate(`/grammar/${note.relatedGrammarId}`));
          return btn;
        })()
      : el("span", {}, [note.textJa]);
    return el("div", { className: "note-item" }, [jaLine, el("p", { className: "note-zh" }, [note.textZh])]);
  });
  return el("section", { className: "additional-notes-section" }, [el("h2", {}, ["補充說明"]), ...items]);
}
