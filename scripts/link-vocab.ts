import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GrammarEntry, VocabEntry, VocabLink } from "../src/data/schema.ts";
import {
  conjugateIAdjective,
  conjugateVerb,
  getSurfaceForms,
} from "../src/modules/conjugation/conjugate.ts";
import { isKanaOnly } from "../src/utils/kana.ts";
import { firstClause } from "../src/utils/text.ts";

const VOCAB_PATH = path.resolve(import.meta.dirname, "../public/data/vocab.json");
const GRAMMAR_PATH = path.resolve(import.meta.dirname, "../public/data/grammar.json");

/**
 * Excludes short kana-only surface forms (する/ない/いる and the like) from the
 * matching lookup — otherwise these near-universal conjugation fragments would
 * spuriously "link" almost every sentence to the wrong word.
 */
function isLinkableSurfaceForm(form: string): boolean {
  return !(isKanaOnly(form) && form.length <= 2);
}

function buildSurfaceFormMap(vocab: VocabEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of vocab) {
    for (const form of getSurfaceForms(entry)) {
      if (!isLinkableSurfaceForm(form)) continue;
      if (!map.has(form)) map.set(form, entry.id);
    }
  }
  return map;
}

/** Greedy longest-match scan of `text` against the known surface-form dictionary. */
function findVocabLinks(text: string, surfaceForms: Map<string, string>, maxLen: number): VocabLink[] {
  const links: VocabLink[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    const upperBound = Math.min(maxLen, text.length - i);
    for (let len = upperBound; len >= 1; len--) {
      const candidate = text.slice(i, i + len);
      const vocabId = surfaceForms.get(candidate);
      if (vocabId) {
        links.push({ vocabId, start: i, end: i + len });
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return links;
}

function bakeConjugatedForms(vocab: VocabEntry[]): void {
  for (const entry of vocab) {
    if (entry.partOfSpeech === "verb" && entry.verb) {
      entry.verb.conjugatedForms = conjugateVerb(
        entry.kanji,
        entry.verb.group,
        entry.verb.overrideForms,
      );
    } else if (entry.partOfSpeech === "i-adjective") {
      entry.adjectiveForms = conjugateIAdjective(entry.kanji);
    }
  }
}

/**
 * Flags vocab whose kanji is visually near-identical to its own (already
 * Traditional-converted, by this point in the pipeline) Chinese meaning - e.g.
 * 電子/電子 - so 連連看 can skip them as a "freebie" match with no training
 * value. Threshold validated against the real dataset: catches 534/3592
 * (14.9%) entries, which felt right by manual spot-check.
 */
function isHomographWithMeaning(kanji: string, meaning: string): boolean {
  const clause = firstClause(meaning);
  if (clause === kanji) return true;
  if (clause.length !== kanji.length || clause.length === 0) return false;
  let same = 0;
  for (let i = 0; i < clause.length; i++) if (clause[i] === kanji[i]) same++;
  return same / clause.length >= 0.7;
}

function flagGameExcluded(vocab: VocabEntry[]): void {
  for (const entry of vocab) {
    if (isHomographWithMeaning(entry.kanji, entry.meaning)) {
      entry.gameExcluded = true;
    }
  }
}

function linkExamples(
  grammar: GrammarEntry[],
  surfaceForms: Map<string, string>,
  vocabById: Map<string, VocabEntry>,
): void {
  const maxLen = Math.max(...[...surfaceForms.keys()].map((f) => f.length), 1);
  for (const entry of grammar) {
    for (const example of entry.examples) {
      const autoLinks = findVocabLinks(example.jp, surfaceForms, maxLen);
      const manualIds = example.manualVocabIds ?? [];
      const manualLinks: VocabLink[] = [];
      for (const vocabId of manualIds) {
        if (autoLinks.some((l) => l.vocabId === vocabId)) continue;
        const vocabEntry = vocabById.get(vocabId);
        // Best-effort: try to anchor the manual link to where the word's kanji form
        // literally appears; if it can't be found (e.g. a conjugated form our surface
        // list didn't cover), still record the link with start=end=-1 so the UI can
        // render it as an unanchored "related word" rather than an inline highlight.
        const idx = vocabEntry ? example.jp.indexOf(vocabEntry.kanji) : -1;
        const len = vocabEntry?.kanji.length ?? 0;
        manualLinks.push({
          vocabId,
          start: idx >= 0 ? idx : -1,
          end: idx >= 0 ? idx + len : -1,
        });
      }
      example.vocabLinks = [...autoLinks, ...manualLinks];
    }
  }
}

function computeGrammarRefs(grammar: GrammarEntry[], vocab: VocabEntry[]): void {
  const refsByVocabId = new Map<string, Set<string>>();
  for (const entry of grammar) {
    for (const example of entry.examples) {
      for (const link of example.vocabLinks ?? []) {
        if (!refsByVocabId.has(link.vocabId)) refsByVocabId.set(link.vocabId, new Set());
        refsByVocabId.get(link.vocabId)!.add(entry.id);
      }
    }
  }
  for (const entry of vocab) {
    const refs = refsByVocabId.get(entry.id);
    if (refs && refs.size > 0) entry.grammarRefs = [...refs].sort();
  }
}

async function main(): Promise<void> {
  const vocab: VocabEntry[] = JSON.parse(await readFile(VOCAB_PATH, "utf-8"));
  const grammar: GrammarEntry[] = JSON.parse(await readFile(GRAMMAR_PATH, "utf-8"));

  bakeConjugatedForms(vocab);
  flagGameExcluded(vocab);
  const surfaceForms = buildSurfaceFormMap(vocab);
  const vocabById = new Map(vocab.map((v) => [v.id, v]));
  linkExamples(grammar, surfaceForms, vocabById);
  computeGrammarRefs(grammar, vocab);

  await writeFile(VOCAB_PATH, JSON.stringify(vocab, null, 2), "utf-8");
  await writeFile(GRAMMAR_PATH, JSON.stringify(grammar, null, 2), "utf-8");

  const totalLinks = grammar.reduce(
    (sum, e) => sum + e.examples.reduce((s, ex) => s + (ex.vocabLinks?.length ?? 0), 0),
    0,
  );
  const linkedVocabCount = vocab.filter((v) => v.grammarRefs && v.grammarRefs.length > 0).length;
  const excludedCount = vocab.filter((v) => v.gameExcluded).length;
  console.log(
    `linked ${totalLinks} vocab occurrences across grammar examples; ${linkedVocabCount} vocab entries have grammarRefs`,
  );
  console.log(`flagged ${excludedCount} vocab entries as gameExcluded (kanji/meaning homographs)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
