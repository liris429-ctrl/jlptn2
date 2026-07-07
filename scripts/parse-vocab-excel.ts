import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import type { PartOfSpeech, VerbGroup, VocabEntry } from "../src/data/schema.ts";
import { slugify } from "./lib/csv-utils.ts";
import { applyOverrides } from "./lib/overrides.ts";

const RAW_PATH = path.resolve(import.meta.dirname, "../data-source/raw/vocab.xlsx");
const OVERRIDES_PATH = path.resolve(
  import.meta.dirname,
  "../data-source/overrides/vocab-overrides.csv",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../public/data/vocab.json");

const POS_MAP: Record<string, PartOfSpeech> = {
  名词: "noun",
  动1: "verb",
  动2: "verb",
  动3: "verb",
  形容词: "i-adjective",
  形容动词: "na-adjective",
  副词: "adverb",
  代词: "pronoun",
  连接词: "conjunction",
  接续词: "conjunction",
  惯用语: "idiom",
  专有词: "properNoun",
  感叹词: "interjection",
};

const GODAN_ENDING_TO_GROUP: Record<string, VerbGroup> = {
  う: "godan-u",
  く: "godan-ku",
  ぐ: "godan-gu",
  す: "godan-su",
  つ: "godan-tsu",
  ぬ: "godan-nu",
  ぶ: "godan-bu",
  む: "godan-mu",
  る: "godan-ru",
};

function resolveVerbGroup(posRaw: string, resolvedKanji: string): VerbGroup {
  if (posRaw === "动2") return "ichidan";
  if (posRaw === "动3") return resolvedKanji === "来る" ? "kuru" : "suru";
  // 动1 = godan; the specific row is derivable mechanically from the dictionary-form ending.
  const ending = resolvedKanji.at(-1) ?? "";
  return GODAN_ENDING_TO_GROUP[ending] ?? "irregular";
}

/** 动3 rows sometimes spell the noun stem with a trailing "～" instead of writing out "する". */
function resolveKanji(rawKanji: string, posRaw: string | undefined): string {
  if (posRaw === "动3" && rawKanji.endsWith("～")) {
    return `${rawKanji.slice(0, -1)}する`;
  }
  return rawKanji;
}

function parsePitchAccent(raw: string | null | undefined): VocabEntry["pitchAccent"] {
  if (raw == null || raw === "") return undefined;
  const text = String(raw).trim();
  const primary = Number.parseInt(text, 10);
  return Number.isNaN(primary) ? { raw: text } : { raw: text, primary };
}

function makeId(kanji: string, yomi: string, seen: Map<string, number>): string {
  const base = `v-${slugify(kanji)}-${slugify(yomi)}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function parseRows(rows: unknown[][]): VocabEntry[] {
  const entries: VocabEntry[] = [];
  const idCounts = new Map<string, number>();
  let currentLesson: string | undefined;

  // row[0]=kanji/word, row[1]=yomi, row[2]=meaning(zh), row[3]=pitch, row[4]=partOfSpeech(raw)
  for (const row of rows.slice(1)) {
    const rawKanji = row[0] != null ? String(row[0]).trim() : "";
    const yomi = row[1] != null ? String(row[1]).trim() : "";
    if (!yomi) {
      // Lesson header row (no reading), e.g. "新标中_1会".
      if (rawKanji) currentLesson = rawKanji;
      continue;
    }

    const meaning = row[2] != null ? String(row[2]).trim() : "";
    const posRaw = row[4] != null ? String(row[4]).trim() : undefined;
    const kanji = resolveKanji(rawKanji, posRaw);
    const partOfSpeech = (posRaw && POS_MAP[posRaw]) || "other";

    const entry: VocabEntry = {
      id: makeId(kanji, yomi, idCounts),
      kanji,
      yomi,
      meaning,
      partOfSpeech,
      pitchAccent: parsePitchAccent(row[3] as string | null),
      sourceLesson: currentLesson,
    };
    if (partOfSpeech === "verb" && posRaw) {
      entry.verb = { group: resolveVerbGroup(posRaw, kanji) };
    }
    entries.push(entry);
  }
  return entries;
}

async function main(): Promise<void> {
  // The ESM build of xlsx doesn't wire up Node's `fs` for readFile() automatically,
  // so read the buffer ourselves and hand it to XLSX.read() instead.
  const buffer = await readFile(RAW_PATH);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

  let entries = parseRows(rows);
  entries = applyOverrides(entries, OVERRIDES_PATH);
  entries.sort((a, b) => a.id.localeCompare(b.id));

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(entries, null, 2), "utf-8");
  console.log(`parsed ${entries.length} vocab entries -> ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
