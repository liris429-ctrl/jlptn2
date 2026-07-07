import type { GrammarEntry } from "../../data/schema.ts";

export interface LessonGroup {
  lessonLabel: string;
  entries: GrammarEntry[];
}

const LESSON_NUMBER = /^第(\d+)課/;
const OTHER_LABEL = "其他";

/**
 * Groups grammar entries by lesson number (e.g. "第1課 - 1" -> "第1課"), sorted
 * numerically so "第10課" doesn't sort before "第2課" the way a plain string sort
 * would. Entries whose lesson text doesn't match the expected format fall into a
 * trailing "其他" bucket rather than being dropped.
 */
export function groupByLesson(entries: GrammarEntry[]): LessonGroup[] {
  const groups = new Map<string, GrammarEntry[]>();
  const otherBucket: GrammarEntry[] = [];

  for (const entry of entries) {
    const match = entry.lesson ? LESSON_NUMBER.exec(entry.lesson) : null;
    if (!match) {
      otherBucket.push(entry);
      continue;
    }
    const label = `第${match[1]}課`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }

  const sorted = [...groups.entries()].sort(([a], [b]) => {
    const numA = Number.parseInt(LESSON_NUMBER.exec(a)![1]!, 10);
    const numB = Number.parseInt(LESSON_NUMBER.exec(b)![1]!, 10);
    return numA - numB;
  });

  const result: LessonGroup[] = sorted.map(([lessonLabel, groupEntries]) => ({
    lessonLabel,
    entries: groupEntries,
  }));
  if (otherBucket.length > 0) {
    result.push({ lessonLabel: OTHER_LABEL, entries: otherBucket });
  }
  return result;
}
