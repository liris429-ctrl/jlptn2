import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JlptLevel, QuizCategory, QuizQuestion } from "../src/data/schema.ts";

const QUIZ_SOURCE_DIR = path.resolve(import.meta.dirname, "../data-source/quiz");
const OUT_PATH = path.resolve(import.meta.dirname, "../public/data/quiz.json");

// All batches provided so far target N2; override per-question with a "jlptLevel"
// field in the source file if a future batch needs a different level.
const DEFAULT_JLPT_LEVEL: JlptLevel = "N2";

const CATEGORIES: QuizCategory[] = ["grammar", "vocab"];

interface RawQuizQuestion {
  id: string;
  source: string;
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
  jlptLevel?: JlptLevel;
}

async function readCategoryDir(category: QuizCategory): Promise<QuizQuestion[]> {
  const dir = path.join(QUIZ_SOURCE_DIR, category);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const questions: QuizQuestion[] = [];
  for (const file of files) {
    const raw: RawQuizQuestion[] = JSON.parse(await readFile(path.join(dir, file), "utf-8"));
    for (const q of raw) {
      questions.push({
        id: q.id,
        category,
        jlptLevel: q.jlptLevel ?? DEFAULT_JLPT_LEVEL,
        source: q.source,
        question: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
      });
    }
  }
  return questions;
}

async function main(): Promise<void> {
  const allQuestions: QuizQuestion[] = [];
  for (const category of CATEGORIES) {
    allQuestions.push(...(await readCategoryDir(category)));
  }

  const idCounts = new Map<string, number>();
  for (const q of allQuestions) idCounts.set(q.id, (idCounts.get(q.id) ?? 0) + 1);
  const duplicates = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    throw new Error(`duplicate quiz ids: ${duplicates.join(", ")}`);
  }

  allQuestions.sort((a, b) => a.id.localeCompare(b.id));

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(allQuestions, null, 2), "utf-8");
  console.log(
    `parsed ${allQuestions.length} quiz questions -> ${path.relative(process.cwd(), OUT_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
