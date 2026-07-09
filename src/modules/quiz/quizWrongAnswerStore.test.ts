import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetWrongAnswersForTest,
  getWrongAnswerRecord,
  listWrongAnswerRecords,
  recordWrongAnswer,
  subscribeWrongAnswers,
} from "./quizWrongAnswerStore.ts";

describe("quizWrongAnswerStore", () => {
  beforeEach(() => _resetWrongAnswersForTest());

  it("starts with no recorded wrong answers", () => {
    expect(getWrongAnswerRecord("q-1")).toBeUndefined();
    expect(listWrongAnswerRecords()).toEqual([]);
  });

  it("recordWrongAnswer creates a record with wrongCount 1", () => {
    recordWrongAnswer("q-1");
    const record = getWrongAnswerRecord("q-1");
    expect(record?.wrongCount).toBe(1);
    expect(record?.firstWrongAt).toBe(record?.lastWrongAt);
  });

  it("recordWrongAnswer on the same question increments wrongCount and keeps firstWrongAt", () => {
    recordWrongAnswer("q-1");
    const first = getWrongAnswerRecord("q-1")!;
    recordWrongAnswer("q-1");
    const second = getWrongAnswerRecord("q-1")!;
    expect(second.wrongCount).toBe(2);
    expect(second.firstWrongAt).toBe(first.firstWrongAt);
  });

  it("listWrongAnswerRecords returns most recently missed first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    recordWrongAnswer("q-1");
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    recordWrongAnswer("q-2");
    vi.useRealTimers();
    const ids = listWrongAnswerRecords().map((r) => r.questionId);
    expect(ids).toEqual(["q-2", "q-1"]);
  });

  it("notifies subscribers on every recordWrongAnswer", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWrongAnswers(listener);
    recordWrongAnswer("q-1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    recordWrongAnswer("q-1");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
