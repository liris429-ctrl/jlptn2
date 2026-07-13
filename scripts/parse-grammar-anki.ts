import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdditionalNote, GrammarEntry, GrammarExample, GrammarSense } from "../src/data/schema.ts";
import { slugify } from "./lib/csv-utils.ts";
import { furiganaBracketToRuby, htmlToPlainText, sanitizeHtml } from "./lib/anki-utils.ts";
import { applyOverrides } from "./lib/overrides.ts";

const RAW_PATH = path.resolve(import.meta.dirname, "../data-source/raw/grammar-notes.json");
const OVERRIDES_PATH = path.resolve(
  import.meta.dirname,
  "../data-source/overrides/grammar-overrides.csv",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../public/data/grammar.json");

/**
 * shin-kanzen-n2-grammar/notes.json's own field names (confirmed against the
 * repo's Anki card template and by direct comparison against notes.csv -
 * that CSV is a *generated* export, and its own generation step swaps the
 * explanationJapanese/explanationChinese and additionalNotes/additionalNotesZh
 * field pairs. notes.json has no such issue; reading it directly by field
 * name needs no swap-compensation at all.
 */
interface RawNote {
  deck: string;
  frontSentence: string;
  grammarPattern: string;
  lessonInfo: string;
  backSentence: string;
  readingFurigana: string;
  translation: string;
  audioFile: string;
  grammarFormation: string;
  richGrammarFormation: string;
  styleNotes: string;
  explanationJapanese: string;
  explanationChinese: string;
  additionalNotes: string;
  additionalNotesZh: string;
  detailedExplanation: string;
  level: string;
  lineNumber: string;
}

function normalizePatternText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[～〜()（）\s]/g, "")
    .trim();
}

function val(note: RawNote, key: keyof RawNote): string {
  return (note[key] ?? "").trim();
}

interface RawGroup {
  pattern: string;
  notes: RawNote[];
}

function groupByPattern(notes: RawNote[]): RawGroup[] {
  const order: string[] = [];
  const groups = new Map<string, RawNote[]>();
  for (const note of notes) {
    const pattern = val(note, "grammarPattern");
    if (!pattern) continue;
    if (!groups.has(pattern)) {
      groups.set(pattern, []);
      order.push(pattern);
    }
    groups.get(pattern)!.push(note);
  }
  return order.map((pattern) => ({ pattern, notes: groups.get(pattern)! }));
}

function buildExample(note: RawNote, entryId: string, index: number): GrammarExample {
  const backHtml = val(note, "backSentence");
  const detailedHtml = val(note, "detailedExplanation");
  return {
    id: `${entryId}-ex${index + 1}`,
    jp: htmlToPlainText(backHtml),
    jpHighlightHtml: backHtml ? sanitizeHtml(backHtml) : undefined,
    furiganaRuby: furiganaBracketToRuby(val(note, "readingFurigana")),
    cn: val(note, "translation"),
    detailedExplanationHtml: detailedHtml ? sanitizeHtml(detailedHtml) : undefined,
    lessonSubgroup: val(note, "lessonInfo"),
  };
}

interface LessonSubgroup {
  lessonSubgroup: string;
  notes: RawNote[];
}

/**
 * Splits a pattern group's notes by their raw lesson label (e.g. さえ's 6
 * notes split into a 5A trio and a 5B trio - two distinct senses taught
 * under separate sub-lessons upstream). Sorted by the label string itself
 * (not left in source order) so senses[0] is deterministically the
 * alphabetically-first sub-group regardless of how the upstream notes
 * happen to interleave.
 */
function groupNotesByLessonSubgroup(notes: RawNote[]): LessonSubgroup[] {
  const order: string[] = [];
  const groups = new Map<string, RawNote[]>();
  for (const note of notes) {
    const lessonSubgroup = val(note, "lessonInfo");
    if (!groups.has(lessonSubgroup)) {
      groups.set(lessonSubgroup, []);
      order.push(lessonSubgroup);
    }
    groups.get(lessonSubgroup)!.push(note);
  }
  return [...order]
    .sort((a, b) => a.localeCompare(b))
    .map((lessonSubgroup) => ({ lessonSubgroup, notes: groups.get(lessonSubgroup)! }));
}

/**
 * One sense per distinct lesson sub-group (see groupNotesByLessonSubgroup) -
 * this is what makes multi-sense grammar points (さえ, に対して, に限って, ...)
 * keep every sense instead of buildEntry's old firstNonEmpty(explanationChinese)
 * silently discarding every sub-group after the first.
 */
function buildSenses(examples: GrammarExample[], subgroups: LessonSubgroup[]): GrammarSense[] {
  const rawSenses = subgroups.map((sg) => ({
    text: firstNonEmpty(sg.notes, "explanationChinese"),
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

function collectAdditionalNotes(notes: RawNote[]): AdditionalNote[] {
  const seen = new Set<string>();
  const result: AdditionalNote[] = [];
  for (const note of notes) {
    const textJa = val(note, "additionalNotes");
    const textZh = val(note, "additionalNotesZh");
    if (!textJa && !textZh) continue;
    const key = `${textJa}::${textZh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ textJa, textZh });
  }
  return result;
}

function firstNonEmpty(notes: RawNote[], key: keyof RawNote): string {
  for (const note of notes) {
    const v = val(note, key);
    if (v) return v;
  }
  return "";
}

function buildEntry(group: RawGroup, idCounts: Map<string, number>): GrammarEntry {
  const baseId = slugify(group.pattern);
  const count = idCounts.get(baseId) ?? 0;
  idCounts.set(baseId, count + 1);
  const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

  const richFormationHtml = firstNonEmpty(group.notes, "richGrammarFormation");

  const examples = group.notes.map((note, i) => buildExample(note, id, i));
  const senses = buildSenses(examples, groupNotesByLessonSubgroup(group.notes));

  return {
    id,
    pattern: group.pattern,
    conjunctionRules: firstNonEmpty(group.notes, "grammarFormation"),
    conjunctionRulesHtml: richFormationHtml ? sanitizeHtml(richFormationHtml) : undefined,
    meaning: senses[0]!.text,
    explanationJa: firstNonEmpty(group.notes, "explanationJapanese") || undefined,
    lesson: firstNonEmpty(group.notes, "lessonInfo") || undefined,
    examples,
    senses,
    additionalNotes: collectAdditionalNotes(group.notes),
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
  const notes = JSON.parse(raw) as RawNote[];
  const groups = groupByPattern(notes);

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
