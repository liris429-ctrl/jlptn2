import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as OpenCC from "opencc-js";
import type { GrammarEntry } from "../src/data/schema.ts";

const GRAMMAR_PATH = path.resolve(import.meta.dirname, "../public/data/grammar.json");

const converter = OpenCC.Converter({ from: "cn", to: "tw" });

/**
 * Only touches fields confirmed to hold Chinese prose. Japanese-only fields
 * (explanationJa, conjunctionRules, kanji, yomi, additionalNotes.textJa) are
 * left untouched so OpenCC's Chinese-oriented dictionary can't misconvert
 * Japan-specific kanji forms.
 *
 * Vocab no longer needs a conversion step here (see v9): the eggrolls source
 * ships native Simplified *and* Traditional columns, so the parser picks the
 * Traditional one directly instead of running it through OpenCC.
 */
export function convertGrammarEntry(entry: GrammarEntry): GrammarEntry {
  return {
    ...entry,
    meaning: converter(entry.meaning),
    examples: entry.examples.map((example) => ({
      ...example,
      cn: converter(example.cn),
      // Safe to convert the raw HTML string directly: OpenCC only substitutes
      // CJK characters, and the tags/attributes here are all plain ASCII.
      detailedExplanationHtml: example.detailedExplanationHtml
        ? converter(example.detailedExplanationHtml)
        : example.detailedExplanationHtml,
    })),
    additionalNotes: entry.additionalNotes?.map((note) => ({
      ...note,
      textZh: converter(note.textZh),
    })),
  };
}

async function main(): Promise<void> {
  const grammar: GrammarEntry[] = JSON.parse(await readFile(GRAMMAR_PATH, "utf-8"));

  const convertedGrammar = grammar.map(convertGrammarEntry);

  await writeFile(GRAMMAR_PATH, JSON.stringify(convertedGrammar, null, 2), "utf-8");

  console.log(`converted ${convertedGrammar.length} grammar entries to Traditional Chinese`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
