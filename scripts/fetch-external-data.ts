import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.resolve(import.meta.dirname, "../data-source/raw");

const SOURCES = [
  // notes.json (not notes.csv) - the repo's own README names notes.json "the
  // sole editable source" and notes.csv "a generated product, do not edit
  // directly". Confirmed the hard way: the notes.csv -> generation step
  // swaps the explanationJapanese/explanationChinese and
  // additionalNotes/additionalNotesZh field pairs, so every grammar meaning
  // parsed from the CSV was actually usage/attachment notes, not the
  // definition. The JSON has no such issue - same content, correct fields.
  {
    url: "https://raw.githubusercontent.com/mxggle/anki-jlpt-n2-grammar-example-sentences/main/shin-kanzen-n2-grammar/notes.json",
    out: "grammar-notes.json",
  },
  {
    url: "https://raw.githubusercontent.com/5mdld/anki-jlpt-decks/main/deck-source/notes.csv",
    out: "vocab-eggrolls.csv",
  },
];

async function fetchOne(source: (typeof SOURCES)[number]): Promise<void> {
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${source.url}: ${res.status} ${res.statusText}`);
  }
  const outPath = path.join(RAW_DIR, source.out);
  if (source.binary) {
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  } else {
    await writeFile(outPath, await res.text(), "utf-8");
  }
  console.log(`fetched ${source.url} -> ${path.relative(process.cwd(), outPath)}`);
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  for (const source of SOURCES) {
    await fetchOne(source);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
