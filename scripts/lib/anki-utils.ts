/** Anki's plain-text CSV export starts with `#key:value` comment lines before the header row. */
export function stripAnkiHeaderComments(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
}

/** Strips all HTML tags, returning plain readable text. */
export function htmlToPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

/**
 * Removes inline `style="..."` attributes and event-handler attributes/`<script>` blocks
 * from source HTML, keeping structural tags/classes so it can be safely styled by our own CSS.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\sstyle="[^"]*"/gi, "")
    .trim();
}

/**
 * Converts the source's bracket furigana notation (`整理券[せいりけん]`, space-delimited
 * tokens) into `<ruby><rt>` HTML, dropping the tokenization spaces that aren't real
 * Japanese whitespace.
 */
export function furiganaBracketToRuby(text: string): string {
  const withRuby = text.replace(
    /(\S+?)\[([^\]\s]+)\]/g,
    (_m, chunk: string, reading: string) => `<ruby>${chunk}<rt>${reading}</rt></ruby>`,
  );
  return withRuby.replace(/ /g, "");
}

/**
 * Strips bracket furigana notation down to just the kanji/base text - some sources
 * (e.g. eggrolls-JLPT10k, for ateji/irregular-reading headwords like 台詞[せりふ])
 * bake the reading straight into the headword field instead of a separate column.
 * Same matching rule as furiganaBracketToRuby, just discarding the reading.
 */
export function furiganaBracketToPlainText(text: string): string {
  return text.replace(/(\S+?)\[([^\]\s]+)\]/g, (_m, chunk: string) => chunk).replace(/ /g, "");
}

export function slugifyId(input: string): string {
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
