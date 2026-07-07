import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdditionalNote, GrammarEntry, GrammarExample } from "../src/data/schema.ts";
import { parseCsvRows, slugify } from "./lib/csv-utils.ts";
import {
  furiganaBracketToRuby,
  htmlToPlainText,
  sanitizeHtml,
  stripAnkiHeaderComments,
} from "./lib/anki-utils.ts";
import { applyOverrides } from "./lib/overrides.ts";

const RAW_PATH = path.resolve(import.meta.dirname, "../data-source/raw/grammar-notes.csv");
const OVERRIDES_PATH = path.resolve(
  import.meta.dirname,
  "../data-source/overrides/grammar-overrides.csv",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../public/data/grammar.json");

// Anki plain-text export column layout (0-indexed), see shin-kanzen-n2-grammar/notes.csv
// header comments (`#deck column:1`, `#tags column:22`) and templates/*.html field names.
const COL = {
  frontSentence: 1,
  pattern: 2,
  lesson: 3,
  backSentenceHtml: 4,
  reading: 5,
  translation: 6,
  grammarFormation: 8,
  richGrammarFormationHtml: 9,
  additionalNotes: 11,
  additionalNotesZh: 12,
  explanationJapanese: 15,
  explanationChinese: 16,
  detailedExplanationHtml: 18,
} as const;

function normalizePatternText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[～〜()（）\s]/g, "")
    .trim();
}

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

interface RawGroup {
  pattern: string;
  rows: string[][];
}

function groupByPattern(rows: string[][]): RawGroup[] {
  const order: string[] = [];
  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const pattern = cell(row, COL.pattern);
    if (!pattern) continue;
    if (!groups.has(pattern)) {
      groups.set(pattern, []);
      order.push(pattern);
    }
    groups.get(pattern)!.push(row);
  }
  return order.map((pattern) => ({ pattern, rows: groups.get(pattern)! }));
}

function buildExample(row: string[], entryId: string, index: number): GrammarExample {
  const backHtml = cell(row, COL.backSentenceHtml);
  const detailedHtml = cell(row, COL.detailedExplanationHtml);
  return {
    id: `${entryId}-ex${index + 1}`,
    jp: htmlToPlainText(backHtml),
    jpHighlightHtml: backHtml ? sanitizeHtml(backHtml) : undefined,
    furiganaRuby: furiganaBracketToRuby(cell(row, COL.reading)),
    cn: cell(row, COL.translation),
    detailedExplanationHtml: detailedHtml ? sanitizeHtml(detailedHtml) : undefined,
  };
}

function collectAdditionalNotes(rows: string[][]): AdditionalNote[] {
  const seen = new Set<string>();
  const notes: AdditionalNote[] = [];
  for (const row of rows) {
    const textJa = cell(row, COL.additionalNotes);
    const textZh = cell(row, COL.additionalNotesZh);
    if (!textJa && !textZh) continue;
    const key = `${textJa}::${textZh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ textJa, textZh });
  }
  return notes;
}

function firstNonEmpty(rows: string[][], index: number): string {
  for (const row of rows) {
    const v = cell(row, index);
    if (v) return v;
  }
  return "";
}

function buildEntry(group: RawGroup, idCounts: Map<string, number>): GrammarEntry {
  const baseId = slugify(group.pattern);
  const count = idCounts.get(baseId) ?? 0;
  idCounts.set(baseId, count + 1);
  const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

  const richFormationHtml = firstNonEmpty(group.rows, COL.richGrammarFormationHtml);
  const detailedFirstRow = firstNonEmpty(group.rows, COL.detailedExplanationHtml);

  return {
    id,
    pattern: group.pattern,
    conjunctionRules: firstNonEmpty(group.rows, COL.grammarFormation),
    conjunctionRulesHtml: richFormationHtml ? sanitizeHtml(richFormationHtml) : undefined,
    meaning: firstNonEmpty(group.rows, COL.explanationChinese),
    explanationJa: firstNonEmpty(group.rows, COL.explanationJapanese) || undefined,
    lesson: firstNonEmpty(group.rows, COL.lesson) || undefined,
    examples: group.rows.map((row, i) => buildExample(row, id, i)),
    additionalNotes: collectAdditionalNotes(group.rows),
  };
}

/**
 * Opportunistically links an additional note to a real GrammarEntry when its Japanese
 * text happens to name one of our imported patterns (e.g. 際に's note mentions ～とき).
 * Most notes are free-text paraphrases that won't match anything, which is expected.
 */
function resolveRelatedGrammarIds(entries: GrammarEntry[]): void {
  const byNormalizedPattern = new Map(entries.map((e) => [normalizePatternText(e.pattern), e.id]));
  for (const entry of entries) {
    if (!entry.additionalNotes) continue;
    for (const note of entry.additionalNotes) {
      const match = byNormalizedPattern.get(normalizePatternText(note.textJa));
      if (match && match !== entry.id) note.relatedGrammarId = match;
    }
  }
}

async function main(): Promise<void> {
  const raw = await readFile(RAW_PATH, "utf-8");
  const rows = parseCsvRows(stripAnkiHeaderComments(raw));
  const groups = groupByPattern(rows);

  const idCounts = new Map<string, number>();
  let entries = groups.map((g) => buildEntry(g, idCounts));
  resolveRelatedGrammarIds(entries);

  entries = applyOverrides(entries, OVERRIDES_PATH);
  entries.sort((a, b) => a.id.localeCompare(b.id));

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(entries, null, 2), "utf-8");
  const exampleCount = entries.reduce((sum, e) => sum + e.examples.length, 0);
  console.log(
    `parsed ${entries.length} grammar entries (${exampleCount} examples) -> ${path.relative(process.cwd(), OUT_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
