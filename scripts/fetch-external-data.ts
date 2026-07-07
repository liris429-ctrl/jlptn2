import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_DIR = path.resolve(import.meta.dirname, "../data-source/raw");

const SOURCES = [
  {
    url: "https://raw.githubusercontent.com/mxggle/anki-jlpt-n2-grammar-example-sentences/main/shin-kanzen-n2-grammar/notes.csv",
    out: "grammar-notes.csv",
  },
  {
    url: "https://raw.githubusercontent.com/RabbearSu/Japanese-Words/master/data/jp_zhongji.xlsx",
    out: "vocab.xlsx",
    binary: true,
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
