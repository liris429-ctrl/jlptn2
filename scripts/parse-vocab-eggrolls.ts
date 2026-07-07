import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  JlptLevel,
  PartOfSpeech,
  VerbGroup,
  VocabEntry,
  VocabExample,
  VocabRelatedWord,
} from "../src/data/schema.ts";
import { parseCsvRows, slugify } from "./lib/csv-utils.ts";
import {
  furiganaBracketToPlainText,
  furiganaBracketToRuby,
  htmlToPlainText,
  stripAnkiHeaderComments,
} from "./lib/anki-utils.ts";
import { applyOverrides } from "./lib/overrides.ts";
import { isKanaOnly } from "../src/utils/kana.ts";

const RAW_PATH = path.resolve(import.meta.dirname, "../data-source/raw/vocab-eggrolls.csv");
const OVERRIDES_PATH = path.resolve(
  import.meta.dirname,
  "../data-source/overrides/vocab-overrides.csv",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../public/data/vocab.json");

// Fixed 39-column layout of eggrolls-JLPT10k's Anki plain-text export (see
// deck-source/notes.csv header comments and README "牌組內容" section).
const COL = {
  deck: 1,
  kanji: 3,
  pitch: 4,
  pos: 5,
  yomi: 6,
  meaningZh: 7,
  meaningTw: 8,
} as const;
// Columns 11-34 are 4 repeating 6-column blocks: [marker, text1, text2, cn-simp, cn-tw, audio].
const BLOCK_START = 11;
const BLOCK_SIZE = 6;
const BLOCK_COUNT = 4;

const CIRCLED_DIGITS: Record<string, string> = {
  "⓪": "0",
  "①": "1",
  "②": "2",
  "③": "3",
  "④": "4",
  "⑤": "5",
  "⑥": "6",
  "⑦": "7",
  "⑧": "8",
  "⑨": "9",
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

/** Single-token POS fallbacks that don't carry a verb/adjective marker (see README's tag table). */
const SIMPLE_POS_MAP: Record<string, PartOfSpeech> = {
  名: "noun",
  副: "adverb",
  代: "pronoun",
  接: "conjunction",
  感: "interjection",
  連語: "idiom",
  成句: "idiom",
};

function resolveLevel(deckPath: string): { jlptLevel: JlptLevel; frequencyTier?: "high" | "mid" | "low" } {
  const levelMatch = /N([1-5])/.exec(deckPath);
  const jlptLevel = `N${levelMatch?.[1] ?? "2"}` as JlptLevel;
  const tierMatch = /(高|中|低)頻/.exec(deckPath);
  const frequencyTier =
    tierMatch?.[1] === "高" ? "high" : tierMatch?.[1] === "中" ? "mid" : tierMatch?.[1] === "低" ? "low" : undefined;
  return { jlptLevel, frequencyTier };
}

function parsePitchAccent(raw: string): VocabEntry["pitchAccent"] {
  if (!raw) return undefined;
  // Two circled digits side by side (e.g. "①③") mean "accent 1 or accent 3 depending
  // on sense", not the two-digit number 13 - only the leading one is meaningful for
  // sorting/display, same "take the leading number, keep the full string as raw"
  // convention as the previous data source's compound "1+0" notation.
  const firstChar = [...raw][0] ?? "";
  const primary = Number.parseInt(CIRCLED_DIGITS[firstChar] ?? firstChar, 10);
  return Number.isNaN(primary) ? { raw } : { raw, primary };
}

/** 動詞群組數字（1/2/3）跟 RabbearSu 的动1/动2/动3 同一套慣例；来る掛在「3」但不規則。 */
function resolvePartOfSpeech(posRaw: string, kanji: string): { partOfSpeech: PartOfSpeech; verbGroup?: VerbGroup } {
  if (/動3/.test(posRaw)) {
    return { partOfSpeech: "verb", verbGroup: kanji === "来る" ? "kuru" : "suru" };
  }
  if (/動2/.test(posRaw)) return { partOfSpeech: "verb", verbGroup: "ichidan" };
  if (/動1/.test(posRaw)) {
    const ending = kanji.at(-1) ?? "";
    return { partOfSpeech: "verb", verbGroup: GODAN_ENDING_TO_GROUP[ending] ?? "irregular" };
  }
  if (posRaw.includes("イ形")) return { partOfSpeech: "i-adjective" };
  if (posRaw.includes("ナ形")) return { partOfSpeech: "na-adjective" };
  const firstToken = posRaw.split("・")[0] ?? posRaw;
  return { partOfSpeech: SIMPLE_POS_MAP[firstToken] ?? SIMPLE_POS_MAP[posRaw] ?? "other" };
}

function makeId(kanji: string, yomi: string, seen: Map<string, number>): string {
  const base = `v-${slugify(kanji)}-${slugify(yomi)}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function parseBlocks(row: string[]): { examples: VocabExample[]; relatedWords: VocabRelatedWord[] } {
  const examples: VocabExample[] = [];
  const relatedWords: VocabRelatedWord[] = [];

  for (let i = 0; i < BLOCK_COUNT; i++) {
    const base = BLOCK_START + i * BLOCK_SIZE;
    const marker = (row[base] ?? "").trim();
    const text1 = (row[base + 1] ?? "").trim();
    const text2 = (row[base + 2] ?? "").trim();
    const cnTw = (row[base + 4] ?? "").trim();
    if (!text1) continue;

    if (marker === "関" || marker === "対") {
      relatedWords.push({
        relation: marker === "対" ? "antonym" : "related",
        kanji: text1,
        furiganaRuby: furiganaBracketToRuby(text2),
        meaning: cnTw,
      });
    } else {
      // text1 is already the plain sentence (no brackets/HTML); text2 is the same
      // sentence with bracket furigana + <b> around the headword.
      examples.push({
        id: `ex-${examples.length + 1}`,
        jp: htmlToPlainText(text1),
        furiganaRuby: furiganaBracketToRuby(text2 || text1),
        cn: cnTw,
      });
    }
  }
  return { examples, relatedWords };
}

function parseRows(rows: string[][]): VocabEntry[] {
  const entries: VocabEntry[] = [];
  const idCounts = new Map<string, number>();

  for (const row of rows) {
    // A handful of ateji/irregular-reading headwords (e.g. 台詞[せりふ]) bake their
    // own furigana bracket into the headword field itself instead of relying on
    // the separate yomi column - strip it back down to plain kanji.
    const kanji = furiganaBracketToPlainText((row[COL.kanji] ?? "").trim());
    const rawYomi = (row[COL.yomi] ?? "").trim();
    if (!kanji || !rawYomi) continue;
    // For katakana loanwords the source repurposes this column as the foreign
    // etymology (e.g. カラー -> "color") instead of a reading - the katakana
    // headword already *is* its own reading, so fall back to it in that case.
    const yomi = isKanaOnly(kanji) ? kanji : rawYomi;

    const posRaw = (row[COL.pos] ?? "").trim();
    const { partOfSpeech, verbGroup } = resolvePartOfSpeech(posRaw, kanji);
    const { jlptLevel, frequencyTier } = resolveLevel(row[COL.deck] ?? "");
    const { examples, relatedWords } = parseBlocks(row);

    const entry: VocabEntry = {
      id: makeId(kanji, yomi, idCounts),
      kanji,
      yomi,
      meaning: (row[COL.meaningTw] || row[COL.meaningZh] || "").trim(),
      partOfSpeech,
      pitchAccent: parsePitchAccent((row[COL.pitch] ?? "").trim()),
      jlptLevel,
      frequencyTier,
    };
    if (verbGroup) entry.verb = { group: verbGroup };
    if (examples.length > 0) entry.examples = examples;
    if (relatedWords.length > 0) entry.relatedWords = relatedWords;

    entries.push(entry);
  }
  return entries;
}

async function main(): Promise<void> {
  const raw = await readFile(RAW_PATH, "utf-8");
  const rows = parseCsvRows(stripAnkiHeaderComments(raw), "\t");

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
