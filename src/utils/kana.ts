/** Folds katakana to hiragana so かんじ and カンジ match the same search query. */
export function katakanaToHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

/**
 * Strips grammar-pattern decoration (～〜, full/half-width parens) so a query like
 * "際に" still matches a stored pattern like "～際（に）" - the parens mark an
 * optional particle in textbook notation, not a real character gap for the learner.
 */
function stripPatternDecoration(input: string): string {
  return input.replace(/[～〜()（）]/g, "");
}

export function normalizeForSearch(input: string): string {
  return stripPatternDecoration(katakanaToHiragana(input.normalize("NFC")).trim().toLowerCase());
}

const KANA_RANGE = /^[぀-ゟ゠-ヿー]+$/;

export function isKanaOnly(input: string): boolean {
  return input.length > 0 && KANA_RANGE.test(input);
}

/**
 * 五十音 (gojuon) ordering for browsing lists. `Intl.Collator("ja")` already
 * handles the real dictionary-order rules (voiced/semi-voiced marks, small kana,
 * the long-vowel mark ー, etc) far better than a hand-rolled comparator would;
 * folding katakana to hiragana first keeps mixed-script readings from sorting
 * as if they were different "letters".
 */
const gojuonCollator = new Intl.Collator("ja");

export function compareYomi(a: string, b: string): number {
  return gojuonCollator.compare(katakanaToHiragana(a), katakanaToHiragana(b));
}
