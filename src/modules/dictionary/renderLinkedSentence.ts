import type { GrammarExample, VocabEntry } from "../../data/schema.ts";

export interface LinkedVocabChip {
  vocabId: string;
  kanji: string;
  yomi: string;
  meaning: string;
}

/**
 * Resolves a grammar example's vocabLinks into the distinct vocab entries they point
 * to, in order of first appearance. Rendered as clickable chips under the example
 * sentence — simpler and more robust than merging furigana-ruby offsets with
 * vocab-link offsets inline, while still satisfying "click a word in the example to
 * jump to its dictionary entry" in both directions.
 */
export function linkedVocabChips(
  example: GrammarExample,
  vocabById: Map<string, VocabEntry>,
): LinkedVocabChip[] {
  const seen = new Set<string>();
  const chips: LinkedVocabChip[] = [];
  for (const link of example.vocabLinks ?? []) {
    if (seen.has(link.vocabId)) continue;
    const vocab = vocabById.get(link.vocabId);
    if (!vocab) continue;
    seen.add(link.vocabId);
    chips.push({ vocabId: vocab.id, kanji: vocab.kanji, yomi: vocab.yomi, meaning: vocab.meaning });
  }
  return chips;
}
