export type PartOfSpeech =
  | "noun"
  | "verb"
  | "i-adjective"
  | "na-adjective"
  | "adverb"
  | "pronoun"
  | "conjunction"
  | "idiom"
  | "properNoun"
  | "interjection"
  | "other";

export type VerbGroup =
  | "godan-u"
  | "godan-ku"
  | "godan-gu"
  | "godan-su"
  | "godan-tsu"
  | "godan-nu"
  | "godan-bu"
  | "godan-mu"
  | "godan-ru"
  | "ichidan"
  | "suru"
  | "kuru"
  | "irregular";

export interface ConjugatedForms {
  masu: string;
  masuNegative: string;
  te: string;
  ta: string;
  nai: string;
  naiPast?: string;
  potential?: string;
  volitional?: string;
  passive?: string;
  causative?: string;
  imperative?: string;
  conditionalBa?: string;
}

export interface VerbConjugationInfo {
  group: VerbGroup;
  irregularNote?: string;
  /** Manual escape hatch: merged on top of generated forms before baking. */
  overrideForms?: Partial<ConjugatedForms>;
  /** Baked at build time by scripts/link-vocab.ts. The client never computes this. */
  conjugatedForms?: ConjugatedForms;
}

export interface PitchAccent {
  /** Raw value as authored in the source data, e.g. "0", "3", "1+0". */
  raw: string;
  /** Leading accent number parsed out of `raw`, for sorting/display. */
  primary?: number;
}

export type JlptLevel = "N1" | "N2" | "N3" | "N4" | "N5";

export interface VocabExample {
  id: string;
  /** Plain sentence text, HTML stripped. */
  jp: string;
  /** Ruby-annotated HTML built from the source's bracket furigana notation; the
   * headword stays wrapped in <b> from the source, giving a free in-context highlight. */
  furiganaRuby: string;
  cn: string;
}

export interface VocabRelatedWord {
  relation: "related" | "antonym";
  kanji: string;
  furiganaRuby: string;
  meaning: string;
}

export interface VocabEntry {
  id: string;
  kanji: string;
  yomi: string;
  meaning: string;
  partOfSpeech: PartOfSpeech;
  pitchAccent?: PitchAccent;
  verb?: VerbConjugationInfo;
  /** Baked at build time for partOfSpeech === "i-adjective" entries; see conjugateIAdjective. */
  adjectiveForms?: Partial<ConjugatedForms>;
  jlptLevel: JlptLevel;
  /** Only present for N1-N3, derived from JLPT past-exam appearance frequency. */
  frequencyTier?: "high" | "mid" | "low";
  examples?: VocabExample[];
  relatedWords?: VocabRelatedWord[];
  tags?: string[];
  /** Computed by scripts/link-vocab.ts: grammar entries whose examples use this word. */
  grammarRefs?: string[];
  /**
   * Computed by scripts/link-vocab.ts: true when kanji is visually near-identical
   * to its own (Traditional-converted) Chinese meaning (e.g. 電子/電子, i.e. no
   * actual translation happening). Excluded from 連連看 - matching it would be a
   * freebie with no training value.
   */
  gameExcluded?: boolean;
}

export interface VocabLink {
  vocabId: string;
  /** Character offset into GrammarExample.jp, inclusive. -1 if unanchored (see end). */
  start: number;
  /**
   * Character offset into GrammarExample.jp, exclusive. -1 together with start === -1
   * means this link couldn't be positioned in the sentence text (e.g. a manual
   * override whose word form wasn't found verbatim) — render it as a standalone
   * "related word" instead of an inline highlight.
   */
  end: number;
}

export interface GrammarExample {
  id: string;
  /** Plain sentence text, HTML stripped. */
  jp: string;
  /** Sentence with the grammar point highlighted, sanitized HTML (no inline styles). */
  jpHighlightHtml?: string;
  /** Ruby-annotated HTML built from the source's bracket furigana notation. */
  furiganaRuby: string;
  cn: string;
  manualVocabIds?: string[];
  /** Computed by scripts/link-vocab.ts. */
  vocabLinks?: VocabLink[];
  detailedExplanationHtml?: string;
}

/**
 * The source data's "补充说明" (supplementary notes) field: free-text notes in
 * Japanese + Chinese. These sometimes name a related grammar point (e.g. 際に's note
 * mentions ～とき) but are not a structured, guaranteed-present comparison table —
 * `relatedGrammarId` is only set when the note's text happens to resolve to one of
 * our imported patterns.
 */
export interface AdditionalNote {
  textJa: string;
  textZh: string;
  relatedGrammarId?: string;
}

export interface GrammarEntry {
  id: string;
  pattern: string;
  conjunctionRules: string;
  conjunctionRulesHtml?: string;
  meaning: string;
  explanationJa?: string;
  lesson?: string;
  examples: GrammarExample[];
  additionalNotes?: AdditionalNote[];
  tags?: string[];
}

export type QuizCategory = "grammar" | "vocab";

export interface QuizQuestion {
  id: string;
  category: QuizCategory;
  jlptLevel: JlptLevel;
  /** Which past exam this question is drawn from, e.g. "2010年7月考題". */
  source: string;
  /** Question stem; the blank is marked in the source text (e.g. （   ）). */
  question: string;
  options: string[];
  /** 0-based index into `options`. */
  answer: number;
  explanation?: string;
}

export interface DataStore {
  grammar: GrammarEntry[];
  vocab: VocabEntry[];
  quiz: QuizQuestion[];
}
