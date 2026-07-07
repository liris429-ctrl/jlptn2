/**
 * The first clause of a multi-sense meaning string (senses are separated by
 * Chinese commas/semicolons in the source data), used both to keep game cells
 * compact and to compare a word's meaning against its own kanji for homograph
 * detection (see scripts/link-vocab.ts).
 */
export function firstClause(meaning: string): string {
  return meaning.split(/[、，;；]/)[0] ?? meaning;
}
