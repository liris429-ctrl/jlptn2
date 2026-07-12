import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdditionalNote, GrammarEntry, GrammarExample, GrammarSense } from "../src/data/schema.ts";
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
    lessonSubgroup: cell(row, COL.lesson),
  };
}

interface LessonSubgroup {
  lessonSubgroup: string;
  rows: string[][];
}

/**
 * Splits a pattern group's rows by their raw lesson label (e.g. さえ's 6 rows
 * split into a 5A trio and a 5B trio - two distinct senses taught under
 * separate sub-lessons upstream). Sorted by the label string itself (not
 * left in CSV row order) so senses[0] is deterministically the
 * alphabetically-first sub-group regardless of how the upstream rows happen
 * to interleave.
 */
function groupRowsByLessonSubgroup(rows: string[][]): LessonSubgroup[] {
  const order: string[] = [];
  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const lessonSubgroup = cell(row, COL.lesson);
    if (!groups.has(lessonSubgroup)) {
      groups.set(lessonSubgroup, []);
      order.push(lessonSubgroup);
    }
    groups.get(lessonSubgroup)!.push(row);
  }
  return [...order]
    .sort((a, b) => a.localeCompare(b))
    .map((lessonSubgroup) => ({ lessonSubgroup, rows: groups.get(lessonSubgroup)! }));
}

/**
 * One sense per distinct lesson sub-group (see groupRowsByLessonSubgroup) -
 * this is what makes multi-sense grammar points (さえ, に対して, に限って, ...)
 * keep every sense instead of buildEntry's old firstNonEmpty(explanationChinese)
 * silently discarding every sub-group after the first. Does NOT fix the
 * separate "meaning/additionalNotes swapped at the source" defect some
 * single-sub-group entries have - a sense built from a single sub-group's
 * explanationChinese still faithfully carries over whatever that column
 * says, wrong or not. That's handled separately (see overrides).
 */
function buildSenses(examples: GrammarExample[], subgroups: LessonSubgroup[]): GrammarSense[] {
  const rawSenses = subgroups.map((sg) => ({
    text: firstNonEmpty(sg.rows, COL.explanationChinese),
    lessonSubgroup: sg.lessonSubgroup,
    exampleIds: examples.filter((ex) => ex.lessonSubgroup === sg.lessonSubgroup).map((ex) => ex.id),
  }));
  return dedupeSensesByText(rawSenses);
}

/**
 * Merges senses whose text is byte-for-byte identical - some points (e.g.
 * ものか) are taught under two separate lesson sub-groups with the exact
 * same definition repeated, which isn't a real second sense. Any difference
 * at all, even a trailing clause, keeps them distinct rather than risking
 * silently merging away a real nuance - only an exact match qualifies.
 */
function dedupeSensesByText(senses: GrammarSense[]): GrammarSense[] {
  const order: string[] = [];
  const byText = new Map<string, GrammarSense>();
  for (const sense of senses) {
    const existing = byText.get(sense.text);
    if (existing) {
      existing.exampleIds = [...existing.exampleIds, ...sense.exampleIds];
      continue;
    }
    byText.set(sense.text, { ...sense });
    order.push(sense.text);
  }
  return order.map((text) => byText.get(text)!);
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

  const examples = group.rows.map((row, i) => buildExample(row, id, i));
  const senses = buildSenses(examples, groupRowsByLessonSubgroup(group.rows));

  return {
    id,
    pattern: group.pattern,
    conjunctionRules: firstNonEmpty(group.rows, COL.grammarFormation),
    conjunctionRulesHtml: richFormationHtml ? sanitizeHtml(richFormationHtml) : undefined,
    meaning: senses[0]!.text,
    explanationJa: firstNonEmpty(group.rows, COL.explanationJapanese) || undefined,
    lesson: firstNonEmpty(group.rows, COL.lesson) || undefined,
    examples,
    senses,
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
