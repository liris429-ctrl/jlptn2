import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.resolve(import.meta.dirname, "../data-source/raw");

const SOURCES = [
  // 請勿改抓 notes.csv！該檔案為 to-csv 匯出產物，存在全體欄位對調之系統性
  // Bug（explanationJapanese/explanationChinese 與
  // additionalNotes/additionalNotesZh 兩組欄位互換，導致文法 meaning 全數變成
  // 接續限制説明、真正定義被錯放進 additionalNotes），故在此改抓官方唯一正確
  // 的源頭 notes.json（repo README 明載其為 "the sole editable source"）。
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
