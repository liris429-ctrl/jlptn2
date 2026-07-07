import type { ConjugatedForms, VerbGroup, VocabEntry } from "../../data/schema.ts";

interface GodanRow {
  u: string;
  i: string;
  a: string;
  e: string;
  o: string;
  /** て/た euphonic (onbin) suffix pair, minus the trailing kana replaced above. */
  te: string;
  ta: string;
}

const GODAN_ROWS: Partial<Record<VerbGroup, GodanRow>> = {
  "godan-u": { u: "う", i: "い", a: "わ", e: "え", o: "お", te: "って", ta: "った" },
  "godan-ku": { u: "く", i: "き", a: "か", e: "け", o: "こ", te: "いて", ta: "いた" },
  "godan-gu": { u: "ぐ", i: "ぎ", a: "が", e: "げ", o: "ご", te: "いで", ta: "いだ" },
  "godan-su": { u: "す", i: "し", a: "さ", e: "せ", o: "そ", te: "して", ta: "した" },
  "godan-tsu": { u: "つ", i: "ち", a: "た", e: "て", o: "と", te: "って", ta: "った" },
  "godan-nu": { u: "ぬ", i: "に", a: "な", e: "ね", o: "の", te: "んで", ta: "んだ" },
  "godan-bu": { u: "ぶ", i: "び", a: "ば", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
  "godan-mu": { u: "む", i: "み", a: "ま", e: "め", o: "も", te: "んで", ta: "んだ" },
  "godan-ru": { u: "る", i: "り", a: "ら", e: "れ", o: "ろ", te: "って", ta: "った" },
};

/** Verbs whose て/た form doesn't follow the regular く-row onbin rule. */
const IKU_EXCEPTION = /行く$/;

function conjugateGodan(dictForm: string, group: VerbGroup): ConjugatedForms {
  const row = GODAN_ROWS[group];
  if (!row) throw new Error(`Not a godan group: ${group}`);
  const stem = dictForm.slice(0, -1);
  const isIku = IKU_EXCEPTION.test(dictForm);
  return {
    masu: `${stem}${row.i}ます`,
    masuNegative: `${stem}${row.i}ません`,
    te: isIku ? `${stem}って` : `${stem}${row.te}`,
    ta: isIku ? `${stem}った` : `${stem}${row.ta}`,
    nai: `${stem}${row.a}ない`,
    naiPast: `${stem}${row.a}なかった`,
    potential: `${stem}${row.e}る`,
    volitional: `${stem}${row.o}う`,
    passive: `${stem}${row.a}れる`,
    causative: `${stem}${row.a}せる`,
    imperative: `${stem}${row.e}`,
    conditionalBa: `${stem}${row.e}ば`,
  };
}

function conjugateIchidan(dictForm: string): ConjugatedForms {
  const stem = dictForm.slice(0, -1);
  return {
    masu: `${stem}ます`,
    masuNegative: `${stem}ません`,
    te: `${stem}て`,
    ta: `${stem}た`,
    nai: `${stem}ない`,
    naiPast: `${stem}なかった`,
    potential: `${stem}られる`,
    volitional: `${stem}よう`,
    passive: `${stem}られる`,
    causative: `${stem}させる`,
    imperative: `${stem}ろ`,
    conditionalBa: `${stem}れば`,
  };
}

function conjugateSuru(dictForm: string): ConjugatedForms {
  const base = dictForm.replace(/する$/, "");
  return {
    masu: `${base}します`,
    masuNegative: `${base}しません`,
    te: `${base}して`,
    ta: `${base}した`,
    nai: `${base}しない`,
    naiPast: `${base}しなかった`,
    potential: `${base}できる`,
    volitional: `${base}しよう`,
    passive: `${base}される`,
    causative: `${base}させる`,
    imperative: `${base}しろ`,
    conditionalBa: `${base}すれば`,
  };
}

function conjugateKuru(dictForm: string): ConjugatedForms {
  // 来る is the only verb whose kanji reading itself shifts (来 read き/く/こ) across forms;
  // the kanji stem "来" is kept and only the trailing kana + reading intent changes.
  const prefix = dictForm.replace(/来る$/, "来");
  return {
    masu: `${prefix}ます`,
    masuNegative: `${prefix}ません`,
    te: `${prefix}て`,
    ta: `${prefix}た`,
    nai: `${prefix}ない`,
    naiPast: `${prefix}なかった`,
    potential: `${prefix}られる`,
    volitional: `${prefix}よう`,
    passive: `${prefix}られる`,
    causative: `${prefix}させる`,
    imperative: `${prefix}い`,
    conditionalBa: `${prefix}れば`,
  };
}

export function conjugateVerb(
  dictForm: string,
  group: VerbGroup,
  overrideForms?: Partial<ConjugatedForms>,
): ConjugatedForms {
  let base: ConjugatedForms;
  if (group === "kuru") {
    base = conjugateKuru(dictForm);
  } else if (group === "suru") {
    base = conjugateSuru(dictForm);
  } else if (group === "ichidan") {
    base = conjugateIchidan(dictForm);
  } else if (group === "irregular") {
    // No general rule available; everything must come from overrideForms.
    base = {
      masu: dictForm,
      masuNegative: dictForm,
      te: dictForm,
      ta: dictForm,
      nai: dictForm,
    };
  } else {
    base = conjugateGodan(dictForm, group);
  }
  return overrideForms ? { ...base, ...overrideForms } : base;
}

/**
 * い-adjective forms. Field names are reused loosely from ConjugatedForms:
 * nai = negative (くない), naiPast = past negative (くなかった), ta = past (かった),
 * te = te-form (くて), conditionalBa = conditional (ければ).
 *
 * いい is the one true exception: it's a special allomorph of 良い used only in the
 * plain affirmative form, and every other conjugation reverts to the よい stem
 * (よくない, not いくない). This must be an exact match, not a suffix check — words
 * like かわいい merely end in いい but conjugate perfectly regularly (かわいくない).
 */
export function conjugateIAdjective(dictForm: string): Partial<ConjugatedForms> {
  const stem = dictForm === "いい" ? "よ" : dictForm.slice(0, -1);
  return {
    nai: `${stem}くない`,
    naiPast: `${stem}くなかった`,
    ta: `${stem}かった`,
    te: `${stem}くて`,
    conditionalBa: `${stem}ければ`,
  };
}

/** Na-adjectives use a uniform copula conjugation, not modeled per-word. */
export const NA_ADJECTIVE_COPULA = {
  positive: "だ",
  positivePolite: "です",
  negative: "じゃない",
  negativePolite: "じゃありません",
  past: "だった",
  pastPolite: "でした",
  pastNegative: "じゃなかった",
  te: "で",
} as const;

/**
 * All surface forms (kanji-based) a vocab entry can appear as in real sentences,
 * used by scripts/link-vocab.ts to auto-detect occurrences in grammar examples.
 */
export function getSurfaceForms(entry: VocabEntry): string[] {
  const forms = new Set<string>([entry.kanji]);
  if (entry.partOfSpeech === "verb" && entry.verb) {
    const conjugated =
      entry.verb.conjugatedForms ??
      conjugateVerb(entry.kanji, entry.verb.group, entry.verb.overrideForms);
    for (const form of Object.values(conjugated)) {
      if (form) forms.add(form);
    }
  } else if (entry.partOfSpeech === "i-adjective") {
    for (const form of Object.values(conjugateIAdjective(entry.kanji))) {
      if (form) forms.add(form);
    }
  }
  return [...forms];
}
