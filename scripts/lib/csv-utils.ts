import Papa from "papaparse";

/** Strips a leading UTF-8 BOM and normalizes to NFC (common Excel/Anki export gotcha). */
export function cleanText(input: string): string {
  return input.replace(/^﻿/, "").normalize("NFC");
}

export function parseCsv<T extends Record<string, unknown> = Record<string, string>>(
  raw: string,
): T[] {
  const result = Papa.parse<T>(cleanText(raw), {
    header: true,
    skipEmptyLines: true,
  });
  if (result.errors.length > 0) {
    const fatal = result.errors.filter((e) => e.type !== "FieldMismatch");
    if (fatal.length > 0) {
      throw new Error(
        `CSV parse errors:\n${fatal.map((e) => `  row ${e.row}: ${e.message}`).join("\n")}`,
      );
    }
  }
  return result.data;
}

/**
 * Parses a headerless CSV (rows only, no header row) into a 2D array of cells.
 * Pass `delimiter` explicitly for large files instead of relying on Papaparse's
 * sniffing, which gets less reliable the bigger the sample it has to guess from.
 */
export function parseCsvRows(raw: string, delimiter?: string): string[][] {
  const result = Papa.parse<string[]>(cleanText(raw), { header: false, delimiter });
  return result.data.filter((row) => row.length > 1 || (row[0] ?? "").trim() !== "");
}

export function slugify(input: string): string {
  return (
    input
      .normalize("NFKC")
      .replace(/[～〜()（）]/g, "")
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "entry"
  );
}
