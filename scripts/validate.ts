import { readFile } from "node:fs/promises";
import path from "node:path";
import type { GrammarEntry, VocabEntry } from "../src/data/schema.ts";

const VOCAB_PATH = path.resolve(import.meta.dirname, "../public/data/vocab.json");
const GRAMMAR_PATH = path.resolve(import.meta.dirname, "../public/data/grammar.json");

const VALID_POS = new Set([
  "noun",
  "verb",
  "i-adjective",
  "na-adjective",
  "adverb",
  "pronoun",
  "conjunction",
  "idiom",
  "properNoun",
  "interjection",
  "other",
]);

const VALID_JLPT_LEVEL = new Set(["N1", "N2", "N3", "N4", "N5"]);

const VALID_VERB_GROUP = new Set([
  "godan-u",
  "godan-ku",
  "godan-gu",
  "godan-su",
  "godan-tsu",
  "godan-nu",
  "godan-bu",
  "godan-mu",
  "godan-ru",
  "ichidan",
  "suru",
  "kuru",
  "irregular",
]);

interface Report {
  errors: string[];
  warnings: string[];
}

function validateVocab(vocab: VocabEntry[], report: Report): void {
  const idCounts = new Map<string, number>();
  for (const entry of vocab) {
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
    if (!entry.kanji) report.errors.push(`vocab ${entry.id}: missing kanji`);
    if (!entry.yomi) report.errors.push(`vocab ${entry.id}: missing yomi`);
    if (!entry.meaning) report.warnings.push(`vocab ${entry.id}: missing meaning`);
    if (!VALID_POS.has(entry.partOfSpeech)) {
      report.errors.push(`vocab ${entry.id}: invalid partOfSpeech "${entry.partOfSpeech}"`);
    }
    if (!VALID_JLPT_LEVEL.has(entry.jlptLevel)) {
      report.errors.push(`vocab ${entry.id}: invalid jlptLevel "${entry.jlptLevel}"`);
    }
    if (entry.partOfSpeech === "verb") {
      if (!entry.verb) report.errors.push(`vocab ${entry.id}: verb missing verb.group`);
      else if (!VALID_VERB_GROUP.has(entry.verb.group)) {
        report.errors.push(`vocab ${entry.id}: invalid verb.group "${entry.verb.group}"`);
      }
    } else if (entry.verb) {
      report.warnings.push(`vocab ${entry.id}: has verb info but partOfSpeech is not "verb"`);
    }
  }
  for (const [id, count] of idCounts) {
    if (count > 1) report.errors.push(`vocab: duplicate id "${id}" (${count} occurrences)`);
  }
}

function validateGrammar(grammar: GrammarEntry[], vocabIds: Set<string>, report: Report): void {
  const idCounts = new Map<string, number>();
  const grammarIds = new Set(grammar.map((g) => g.id));
  for (const entry of grammar) {
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
    if (!entry.pattern) report.errors.push(`grammar ${entry.id}: missing pattern`);
    if (!entry.meaning) report.warnings.push(`grammar ${entry.id}: missing meaning`);
    if (entry.examples.length === 0) {
      report.warnings.push(`grammar ${entry.id}: has no examples`);
    }
    for (const example of entry.examples) {
      if (!example.jp) report.errors.push(`grammar ${entry.id}/${example.id}: missing jp text`);
      if (!example.cn) report.warnings.push(`grammar ${entry.id}/${example.id}: missing cn translation`);
      for (const vocabId of example.manualVocabIds ?? []) {
        if (!vocabIds.has(vocabId)) {
          report.errors.push(
            `grammar ${entry.id}/${example.id}: manualVocabIds references unknown vocab id "${vocabId}"`,
          );
        }
      }
    }
    for (const note of entry.additionalNotes ?? []) {
      if (note.relatedGrammarId && !grammarIds.has(note.relatedGrammarId)) {
        report.errors.push(
          `grammar ${entry.id}: additionalNotes.relatedGrammarId references unknown grammar id "${note.relatedGrammarId}"`,
        );
      }
    }
  }
  for (const [id, count] of idCounts) {
    if (count > 1) report.errors.push(`grammar: duplicate id "${id}" (${count} occurrences)`);
  }
}

async function main(): Promise<void> {
  const vocab: VocabEntry[] = JSON.parse(await readFile(VOCAB_PATH, "utf-8"));
  const grammar: GrammarEntry[] = JSON.parse(await readFile(GRAMMAR_PATH, "utf-8"));

  const report: Report = { errors: [], warnings: [] };
  validateVocab(vocab, report);
  validateGrammar(grammar, new Set(vocab.map((v) => v.id)), report);

  if (report.warnings.length > 0) {
    console.warn(`${report.warnings.length} warning(s):`);
    for (const w of report.warnings.slice(0, 50)) console.warn(`  ${w}`);
    if (report.warnings.length > 50) console.warn(`  ...and ${report.warnings.length - 50} more`);
  }
  if (report.errors.length > 0) {
    console.error(`${report.errors.length} error(s):`);
    for (const e of report.errors) console.error(`  ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `validate: OK (${vocab.length} vocab, ${grammar.length} grammar, ${report.warnings.length} warnings)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
