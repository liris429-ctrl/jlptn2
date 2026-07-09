/**
 * Persistent history of quiz questions the user has gotten wrong, separate from
 * QuizState.answers (which only lives for the current session). Kept as its own
 * module - not merged into weakWordsStore - because quiz questions aren't
 * grammar/vocab entries with a detail page to link back to; this is a plain
 * per-question tally, not a "browse and clear" list like favorites/weak words.
 */
const STORAGE_KEY = "n2-quiz-wrong-answers";

export interface QuizWrongAnswerRecord {
  questionId: string;
  wrongCount: number;
  firstWrongAt: string;
  lastWrongAt: string;
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function load(): Map<string, QuizWrongAnswerRecord> {
  if (!hasLocalStorage()) return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const records = raw ? (JSON.parse(raw) as QuizWrongAnswerRecord[]) : [];
    return new Map(records.map((record) => [record.questionId, record]));
  } catch {
    return new Map();
  }
}

function persist(records: Map<string, QuizWrongAnswerRecord>): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...records.values()]));
  } catch {
    // Storage unavailable (private browsing quota etc.) - history stays in-memory for this session.
  }
}

let records = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Call once per wrong answer - increments the tally and bumps lastWrongAt. */
export function recordWrongAnswer(questionId: string): void {
  const now = new Date().toISOString();
  const existing = records.get(questionId);
  records.set(
    questionId,
    existing
      ? { ...existing, wrongCount: existing.wrongCount + 1, lastWrongAt: now }
      : { questionId, wrongCount: 1, firstWrongAt: now, lastWrongAt: now },
  );
  persist(records);
  emit();
}

export function getWrongAnswerRecord(questionId: string): QuizWrongAnswerRecord | undefined {
  return records.get(questionId);
}

/** Most recently missed first. */
export function listWrongAnswerRecords(): QuizWrongAnswerRecord[] {
  return [...records.values()].sort((a, b) => b.lastWrongAt.localeCompare(a.lastWrongAt));
}

export function subscribeWrongAnswers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: reset in-memory state so each test starts clean. */
export function _resetWrongAnswersForTest(): void {
  records = new Map();
  listeners.clear();
}
