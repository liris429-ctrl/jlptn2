import { isKanaOnly } from "./kana.ts";

/**
 * Builds a `<ruby>` annotation for a single dictionary-form word (not a full sentence).
 * Grammar example sentences use the source data's own bracket furigana notation instead
 * (see scripts/lib/anki-utils.ts furiganaBracketToRuby) — this is only for vocab entries.
 *
 * Heuristic: strip the longest common kana suffix shared by `kanji` and `yomi` (the
 * okurigana, e.g. 助かる/たすかる -> かる), then ruby just the remaining kanji-only
 * prefix against the remaining reading prefix. If the remaining prefix still mixes
 * kana and kanji (e.g. words with leading okurigana), fall back to one ruby spanning
 * the whole word — always valid, just less granular.
 */
export function toRubyHtml(kanji: string, yomi: string): string {
  if (kanji === yomi || isKanaOnly(kanji)) return kanji;

  let i = kanji.length;
  let j = yomi.length;
  while (i > 0 && j > 0 && isKanaOnly(kanji[i - 1]!) && kanji[i - 1] === yomi[j - 1]) {
    i--;
    j--;
  }

  const kanjiPrefix = kanji.slice(0, i);
  const okurigana = kanji.slice(i);
  const yomiPrefix = yomi.slice(0, j);

  if (kanjiPrefix.length === 0) return kanji;
  if (/[぀-ゟ゠-ヿー]/.test(kanjiPrefix)) {
    return `<ruby>${kanji}<rt>${yomi}</rt></ruby>`;
  }
  return `<ruby>${kanjiPrefix}<rt>${yomiPrefix}</rt></ruby>${okurigana}`;
}
