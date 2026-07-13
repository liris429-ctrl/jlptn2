import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JlptLevel, QuizCategory, QuizPassage, QuizQuestion } from "../src/data/schema.ts";

const QUIZ_SOURCE_DIR = path.resolve(import.meta.dirname, "../data-source/quiz");
const QUESTIONS_OUT_PATH = path.resolve(import.meta.dirname, "../public/data/quiz.json");
const PASSAGES_OUT_PATH = path.resolve(import.meta.dirname, "../public/data/quiz-passages.json");

// Used when a raw entry doesn't set "level" itself.
const DEFAULT_JLPT_LEVEL: JlptLevel = "N2";

const CATEGORY_LABELS: Record<string, QuizCategory> = {
  文法: "grammar",
  單字: "vocab",
  閱讀: "reading",
  grammar: "grammar",
  vocab: "vocab",
  reading: "reading",
};

function resolveCategory(raw: string, entryId: string): QuizCategory {
  const category = CATEGORY_LABELS[raw];
  if (!category) throw new Error(`quiz ${entryId}: unrecognized category "${raw}"`);
  return category;
}

interface RawSubQuestion {
  q_number: number;
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
}

interface RawQuizEntry {
  id: string;
  source: string;
  level?: JlptLevel;
  category: string;
  question?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
  // Reading-passage entries nest their sub-questions here instead of using
  // question/options/answer directly on the entry.
  passage?: string;
  questions?: RawSubQuestion[];
}

function buildPlainQuestion(entry: RawQuizEntry, category: QuizCategory): QuizQuestion {
  return {
    id: entry.id,
    category,
    jlptLevel: entry.level ?? DEFAULT_JLPT_LEVEL,
    source: entry.source,
    question: entry.question ?? "",
    options: entry.options ?? [],
    answer: entry.answer ?? -1,
    explanation: entry.explanation || undefined,
  };
}

function buildReadingGroup(
  entry: RawQuizEntry,
): { passage: QuizPassage; questions: QuizQuestion[] } {
  const jlptLevel = entry.level ?? DEFAULT_JLPT_LEVEL;
  const passage: QuizPassage = {
    id: entry.id,
    jlptLevel,
    source: entry.source,
    passageJa: entry.passage ?? "",
  };
  const questions = (entry.questions ?? []).map((sub) => ({
    id: `${entry.id}_q${sub.q_number}`,
    category: "reading" as const,
    jlptLevel,
    source: entry.source,
    question: sub.question,
    options: sub.options,
    answer: sub.answer,
    explanation: sub.explanation || undefined,
    passageId: entry.id,
  }));
  return { passage, questions };
}

async function main(): Promise<void> {
  const files = (await readdir(QUIZ_SOURCE_DIR)).filter((f) => f.endsWith(".json")).sort();

  const allQuestions: QuizQuestion[] = [];
  const allPassages: QuizPassage[] = [];

  for (const file of files) {
    const raw: RawQuizEntry[] = JSON.parse(
      await readFile(path.join(QUIZ_SOURCE_DIR, file), "utf-8"),
    );
    for (const entry of raw) {
      const category = resolveCategory(entry.category, entry.id);
      if (category === "reading") {
        const { passage, questions } = buildReadingGroup(entry);
        allPassages.push(passage);
        allQuestions.push(...questions);
      } else {
        allQuestions.push(buildPlainQuestion(entry, category));
      }
    }
  }

  const idCounts = new Map<string, number>();
  for (const q of allQuestions) idCounts.set(q.id, (idCounts.get(q.id) ?? 0) + 1);
  const duplicates = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    throw new Error(`duplicate quiz ids: ${duplicates.join(", ")}`);
  }

  allQuestions.sort((a, b) => a.id.localeCompare(b.id));
  allPassages.sort((a, b) => a.id.localeCompare(b.id));

  await mkdir(path.dirname(QUESTIONS_OUT_PATH), { recursive: true });
  await writeFile(QUESTIONS_OUT_PATH, JSON.stringify(allQuestions, null, 2), "utf-8");
  await writeFile(PASSAGES_OUT_PATH, JSON.stringify(allPassages, null, 2), "utf-8");
  console.log(
    `parsed ${allQuestions.length} quiz questions (${allPassages.length} reading passages) -> ` +
      `${path.relative(process.cwd(), QUESTIONS_OUT_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
