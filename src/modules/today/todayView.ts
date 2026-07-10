import { getStoreSync } from "../../data/store.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import {
  daysUntil,
  getDailyStatsRange,
  getDueCount,
  getMeta,
  getRecentWrongEntries,
  getStreak,
  getStudyDate,
  getWeekSummary,
  recordAnswer,
  setMeta,
  subscribeSrs,
  type DailyStats,
  type WeekSummary,
  type WordState,
} from "./srsStore.ts";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const ACCURACY_BAR_DAYS = 21;

type PhaseKey = "explore" | "review" | "sprint";

interface PhaseInfo {
  label: string;
  poolCounts: { review: number; weak: number; new: number };
}

const PHASES: Record<PhaseKey, PhaseInfo> = {
  explore: { label: "探索期，以新內容為主", poolCounts: { review: 5, weak: 2, new: 3 } },
  review: { label: "總複習期，弱點加強", poolCounts: { review: 5, weak: 4, new: 1 } },
  sprint: { label: "衝刺期，只做弱點", poolCounts: { review: 4, weak: 6, new: 0 } },
};

/** days === null (no examDate set yet) defaults to the longest-runway phase. */
export function phaseForDays(days: number | null): PhaseInfo {
  if (days == null || days > 90) return PHASES.explore;
  if (days > 30) return PHASES.review;
  return PHASES.sprint;
}

interface TodayData {
  today: string;
  examDate: string | null;
  days: number | null;
  phase: PhaseInfo;
  dueCount: number;
  recentWrong: WordState[];
  accuracyDays: { date: string; stats: DailyStats | undefined }[];
  streak: number;
  week: WeekSummary;
  streakBroken: boolean;
}

async function loadTodayData(): Promise<TodayData> {
  const today = getStudyDate();
  const [examDate, dueCount, recentWrong, statsRange, streak, week] = await Promise.all([
    getMeta<string>("examDate"),
    getDueCount(),
    getRecentWrongEntries(5),
    getDailyStatsRange(ACCURACY_BAR_DAYS),
    getStreak(),
    getWeekSummary(),
  ]);

  const statsByDate = new Map(statsRange.map((s) => [s.date, s]));
  const accuracyDays: { date: string; stats: DailyStats | undefined }[] = [];
  for (let i = ACCURACY_BAR_DAYS - 1; i >= 0; i--) {
    const date = addDaysLocal(today, -i);
    accuracyDays.push({ date, stats: statsByDate.get(date) });
  }

  const yesterday = statsByDate.get(addDaysLocal(today, -1));
  const dayBefore = statsByDate.get(addDaysLocal(today, -2));
  const streakBroken = (yesterday?.answered ?? 0) === 0 && (dayBefore?.answered ?? 0) > 0;

  const days = examDate ? daysUntil(examDate, today) : null;

  return {
    today,
    examDate: examDate ?? null,
    days,
    phase: phaseForDays(days),
    dueCount,
    recentWrong,
    accuracyDays,
    streak,
    week,
    streakBroken,
  };
}

function addDaysLocal(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatGreetingDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return `${m}月${d}日(${WEEKDAY_LABELS[date.getDay()]})`;
}

export async function renderTodayView(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  const page = el("div", { className: "today-page" });
  container.append(page);

  // Persisted across re-renders (not just local to one render pass) so the
  // accordion's expanded card survives the full-page rebuild that a
  // subscribeSrs emit triggers - see renderRecentWrongSection.
  let expandedKey: string | null = null;
  let justConfirmedKey: string | null = null;

  let renderToken = 0;
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    const data = await loadTodayData();
    if (token !== renderToken) return;

    page.innerHTML = "";
    const children: (Node | string)[] = [];
    const banner = renderBanner(data);
    if (banner) children.push(banner);
    children.push(
      renderGreeting(data),
      renderCountdownRow(data, render),
      renderMainCta(data),
      renderRecentWrongSection(data, {
        getExpandedKey: () => expandedKey,
        setExpandedKey: (key) => {
          expandedKey = key;
          void render();
        },
        // Read-only here - every card in this pass must see the same value.
        // Cleared once below, after the whole pass has rendered, not per-card.
        getJustConfirmedKey: () => justConfirmedKey,
        markConfirmed: (key) => {
          justConfirmedKey = key;
        },
      }),
      renderStatsSection(data),
    );
    page.append(...children);
    justConfirmedKey = null;
  };

  const unsubscribe = subscribeSrs(() => {
    render();
  });
  window.addEventListener(
    "hashchange",
    () => {
      unsubscribe();
    },
    { once: true },
  );

  await render();
}

/** Only the streak-break condition is implemented - the spec's backup-reminder
 * banner depends on a backup/export feature and settings page that don't
 * exist yet in this app, so it's deferred rather than wired to a dead button. */
function renderBanner(data: TodayData): HTMLElement | null {
  if (!data.streakBroken) return null;
  return el("p", { className: "today-banner" }, ["連續紀錄中斷了，今天重新開始。"]);
}

function renderGreeting(data: TodayData): HTMLElement {
  return el("div", { className: "today-greeting" }, [
    el("h1", {}, ["今日"]),
    el("p", { className: "today-greeting-date" }, [formatGreetingDate(data.today)]),
  ]);
}

function renderCountdownRow(data: TodayData, onChange: () => void): HTMLElement {
  if (data.examDate == null) {
    const trigger = el("button", { className: "btn btn--secondary", type: "button" }, ["設定考試日期"]);
    const input = el("input", { className: "today-exam-date-input", type: "date" });
    input.style.display = "none";
    input.addEventListener("change", () => {
      if (input.value) {
        void setMeta("examDate", input.value).then(onChange);
      }
    });
    trigger.addEventListener("click", () => {
      trigger.style.display = "none";
      input.style.display = "";
      input.showPicker?.();
      input.focus();
    });
    return el("div", { className: "today-countdown-row" }, [trigger, input]);
  }

  return el("div", { className: "today-countdown-row" }, [
    el("span", {}, [
      "N2 考試 ",
      (() => {
        const span = el("span", { className: "today-countdown-days" }, [`D-${data.days}`]);
        return span;
      })(),
    ]),
    el("span", {}, [`・${data.phase.label}`]),
  ]);
}

function renderMainCta(data: TodayData): HTMLElement {
  const btn = el("button", { className: "today-main-cta", type: "button" }, [
    el("span", { className: "today-main-cta-title" }, ["今天的10題"]),
    el("span", { className: "today-main-cta-sub" }, [`待複習 ${data.dueCount}`]),
  ]);
  btn.addEventListener("click", () => navigate("/today/quiz"));
  return btn;
}

interface WrongCardHandle {
  getExpandedKey(): string | null;
  setExpandedKey(key: string | null): void;
  getJustConfirmedKey(): string | null;
  markConfirmed(key: string): void;
}

function renderRecentWrongSection(data: TodayData, handle: WrongCardHandle): HTMLElement {
  const title = el("h2", { className: "today-section-title" }, ["最近錯題"]);
  if (data.recentWrong.length === 0) {
    return el("section", {}, [title, el("p", { className: "today-empty" }, ["最近沒有錯題，保持下去！"])]);
  }
  const list = el(
    "div",
    { className: "today-wrong-list" },
    data.recentWrong.map((w) => renderWrongCard(w, handle)),
  );
  return el("section", {}, [title, list]);
}

function wrongCount(w: WordState): number {
  return w.recent.filter((e) => e.r === 0).length;
}

function renderWrongCard(w: WordState, handle: WrongCardHandle): HTMLElement {
  const store = getStoreSync();
  const expanded = handle.getExpandedKey() === w.key;
  const justConfirmed = handle.getJustConfirmedKey() === w.key;

  const kindLabel = w.kind === "vocab" ? "單字" : "文法";
  let primaryText = "";
  let revealChildren: (Node | string)[] = [];

  if (w.kind === "vocab") {
    const entry = store.vocabById.get(w.id);
    if (!entry) return el("div", {});
    primaryText = entry.kanji;
    revealChildren = [`${entry.yomi}・${entry.meaning}`];
  } else {
    const entry = store.grammarById.get(w.id);
    if (!entry) return el("div", {});
    primaryText = entry.pattern;
    const diffNote = entry.additionalNotes?.[0]?.textZh;
    revealChildren = diffNote ? [`${entry.meaning}・${diffNote}`] : [entry.meaning];
  }

  const head = el("div", { className: "today-wrong-head" }, [
    el("span", { className: "result-kind" }, [kindLabel]),
    el("span", { className: "today-wrong-primary" }, [primaryText]),
    el("span", { className: "today-wrong-count" }, [`×${wrongCount(w)}`]),
  ]);

  const card = el("div", { className: `today-wrong-card${justConfirmed ? " today-wrong-card--flash" : ""}` }, [
    head,
  ]);

  if (expanded) {
    const reveal = el("p", { className: "today-wrong-reveal" }, revealChildren);
    reveal.addEventListener("click", (event) => {
      event.stopPropagation();
      handle.markConfirmed(w.key);
      void recordAnswer(w.kind as FavoriteKind, w.id, true, "anki");
    });
    card.append(reveal, el("p", { className: "today-wrong-hint" }, ["點一下：想起來了"]));
  }

  card.addEventListener("click", () => {
    if (!expanded) {
      handle.setExpandedKey(w.key);
      return;
    }
    navigate(w.kind === "vocab" ? `/vocab/${w.id}` : `/grammar/${w.id}`);
  });

  return card;
}

function accuracyTier(stats: DailyStats | undefined): string {
  const answered = stats?.answered ?? 0;
  if (answered === 0) return "";
  if (answered < 10) return " today-accuracy-cell--tier1";
  if (answered < 20) return " today-accuracy-cell--tier2";
  return " today-accuracy-cell--tier3";
}

function renderStatsSection(data: TodayData): HTMLElement {
  const bar = el(
    "div",
    { className: "today-accuracy-bar" },
    data.accuracyDays.map((d) => el("span", { className: `today-accuracy-cell${accuracyTier(d.stats)}` })),
  );

  const streakText = data.streak > 0 ? `連續 ${data.streak} 天` : "尚未開始連續紀錄";
  const streakEl = el("span", { className: data.streak > 0 ? "today-streak--fresh" : "" }, [streakText]);

  const weekParts: string[] = [`本週 ${data.week.totalAnswered} 題`];
  if (data.week.accuracyPct != null) weekParts.push(`${data.week.accuracyPct}%`);
  if (data.week.weakerCategory != null) {
    weekParts.push(data.week.weakerCategory === "grammar" ? "文法較弱" : "單字較弱");
  }

  return el("section", { className: "today-stats" }, [
    bar,
    el("div", { className: "today-stats-row" }, [streakEl, el("span", {}, [weekParts.join("・")])]),
  ]);
}
