import { readFileSync, existsSync } from "node:fs";
import { parseCsv } from "./csv-utils.ts";

interface OverrideRow {
  id: string;
  field: string;
  value: string;
}

/** Sets a shallow or one-level-nested dot path, e.g. "meaning" or "verb.group". */
function setPath(target: Record<string, unknown>, path: string, value: string): void {
  const [head, ...rest] = path.split(".");
  if (!head) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const nested = (target[head] as Record<string, unknown> | undefined) ?? {};
  target[head] = nested;
  setPath(nested, rest.join("."), value);
}

/**
 * Applies `id,field,value` override rows on top of already-parsed entries, matched by id.
 * This is the escape hatch for individual corrections without touching the raw source data.
 */
export function applyOverrides<T extends { id: string }>(entries: T[], overridesPath: string): T[] {
  if (!existsSync(overridesPath)) return entries;
  const raw = readFileSync(overridesPath, "utf-8");
  const rows = parseCsv<OverrideRow>(raw);
  if (rows.length === 0) return entries;

  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const row of rows) {
    if (!row.id || !row.field) continue;
    const entry = byId.get(row.id);
    if (!entry) {
      console.warn(`override skipped: no entry with id "${row.id}" in ${overridesPath}`);
      continue;
    }
    setPath(entry as Record<string, unknown>, row.field, row.value);
  }
  return entries;
}
