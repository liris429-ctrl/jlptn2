import type { PartOfSpeech } from "../../data/schema.ts";

export const POS_LABEL: Record<PartOfSpeech, string> = {
  noun: "名詞",
  verb: "動詞",
  "i-adjective": "い形容詞",
  "na-adjective": "な形容詞",
  adverb: "副詞",
  pronoun: "代名詞",
  conjunction: "接続詞",
  idiom: "慣用句",
  properNoun: "固有名詞",
  interjection: "感嘆詞",
  other: "その他",
};

export const POS_LABEL_SHORT: Record<PartOfSpeech, string> = {
  noun: "名",
  verb: "動",
  "i-adjective": "形",
  "na-adjective": "形動",
  adverb: "副",
  pronoun: "代",
  conjunction: "接",
  idiom: "慣",
  properNoun: "固有",
  interjection: "感",
  other: "其他",
};
