import { getStoreSync } from "../../data/store.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import type { FavoriteKind } from "../favorites/favoritesStore.ts";
import {
  daysUntil,
  getDailyGrammarPick,
  getDailyStatsRange,
  getDueCount,
  getMeta,
  getNewCount,
  getRecentWrongEntries,
  getStreak,
  getStudyDate,
  getTodayFirstRoundResult,
  getWeakCount,
  getWeekSummary,
  getYesterdayNewWords,
  recentWrongCount,
  recordAnswer,
  setMeta,
  subscribeSrs,
  type DailyStats,
  type WeekSummary,
  type WordState,
} from "./srsStore.ts";
import { consumePendingCelebration, getInProgressRoundSummary } from "./todayQuizEngine.ts";
import { TODAY_ICONS } from "./todayIcons.ts";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const ACCURACY_BAR_DAYS = 21;

type PhaseKey = "explore" | "review" | "sprint";

interface PhaseInfo {
  label: string;
  poolCounts: { review: number; weak: number; new: number };
}

const PHASES: Record<PhaseKey, PhaseInfo> = {
  explore: { label: "打底期，以新內容為主", poolCounts: { review: 5, weak: 2, new: 3 } },
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
  weakCount: number;
  newCount: number;
  recentWrong: WordState[];
  yesterdayNewCount: number;
  dailyGrammarId: string | null;
  activityDays: { date: string; stats: DailyStats | undefined }[];
  streak: number;
  week: WeekSummary;
  streakBroken: boolean;
  /** Round 1's ("今日十問") own score, once it's finished today - drives the
   * main CTA's "已完成" receipt state. */
  firstRoundResult: { correct: number; total: number } | null;
  /** A round left mid-way earlier today - drives the main CTA's "進行中"
   * state ("繼續・第 X/10 題"). */
  inProgress: { currentIndex: number; total: number } | null;
}

async function loadTodayData(): Promise<TodayData> {
  const today = getStudyDate();
  const [
    examDate,
    dueCount,
    weakCount,
    newCount,
    recentWrong,
    statsRange,
    streak,
    week,
    yesterdayNew,
    dailyGrammarId,
    firstRoundResult,
    inProgress,
  ] = await Promise.all([
    getMeta<string>("examDate"),
    getDueCount(),
    getWeakCount(),
    getNewCount(),
    getRecentWrongEntries(5),
    getDailyStatsRange(ACCURACY_BAR_DAYS),
    getStreak(),
    getWeekSummary(),
    getYesterdayNewWords(),
    getDailyGrammarPick(today),
    getTodayFirstRoundResult(),
    getInProgressRoundSummary(),
  ]);

  const statsByDate = new Map(statsRange.map((s) => [s.date, s]));
  const activityDays: { date: string; stats: DailyStats | undefined }[] = [];
  for (let i = ACCURACY_BAR_DAYS - 1; i >= 0; i--) {
    const date = addDaysLocal(today, -i);
    activityDays.push({ date, stats: statsByDate.get(date) });
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
    weakCount,
    newCount,
    recentWrong,
    yesterdayNewCount: yesterdayNew.length,
    dailyGrammarId,
    activityDays,
    streak,
    week,
    streakBroken,
    firstRoundResult,
    inProgress,
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

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return `${m}/${d}`;
}

function icon(svg: string): HTMLElement {
  const span = el("span", { className: "today-icon", "aria-hidden": "true" });
  span.innerHTML = svg;
  return span;
}

const CONFETTI_COLORS = ["var(--accent)", "var(--success)", "var(--moss)", "var(--accent-ink)"];
const CONFETTI_PIECE_COUNT = 26;
const CONFETTI_LIFETIME_MS = 1400;

/** A brief, real falling-particle burst anchored to a completion moment (round
 * 1 finishing, opening today's grammar pick) - not the app's usual restrained
 * motion language (see game.css's combo-milestone for that), but a
 * deliberately bigger celebratory exception for this one class of "you did
 * the thing" event. Colors are drawn only from existing tokens (accent/
 * success/moss), so it still reads as this app's palette, not a generic
 * confetti library dropped in. Reduced-motion users get this for free via
 * base.css's global animation-duration override - no separate JS check
 * needed here. */
function burstConfetti(anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const field = el("div", { className: "today-confetti", "aria-hidden": "true" });
  field.style.left = `${rect.left + rect.width / 2}px`;
  field.style.top = `${rect.top + rect.height / 2}px`;

  for (let i = 0; i < CONFETTI_PIECE_COUNT; i++) {
    const piece = el("span", { className: "today-confetti-piece" });
    const angle = (Math.random() - 0.5) * 150;
    const distance = 50 + Math.random() * 90;
    piece.style.setProperty("--dx", `${Math.sin((angle * Math.PI) / 180) * distance}px`);
    piece.style.setProperty("--dy", `${-(70 + Math.random() * 50)}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 100}ms`);
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    field.append(piece);
  }

  document.body.append(field);
  setTimeout(() => field.remove(), CONFETTI_LIFETIME_MS);
}

export async function renderTodayView(container: HTMLElement): Promise<void> {
  container.innerHTML = "";
  const page = el("div", { className: "today-page" });
  container.append(page);

  // Persisted across re-renders (not just local to one render pass) so the
  // accordion's expanded card survives the full-page rebuild that a
  // subscribeSrs emit triggers - see renderRecentWrongSection.
  let expandedKey: string | null = null;

  // "想起來了" dismissal is session-only UI state, never written to
  // IndexedDB (recordAnswer already durably records the "remembered" event
  // via lastWrongAt/mastery - this Set is purely about what the *list*
  // shows right now). It resets whenever this view is (re)mounted, so a
  // word still inside the 7-day window legitimately reappears next time the
  // page is opened - that's "tomorrow is a fresh batch", not a bug.
  const dismissedThisSession = new Set<string>();
  const activeToastKeys = new Set<string>();
  const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Which activity-heatmap cell's tooltip is open, if any - toggled by
  // tapping a cell (see renderStatsSection). Persisted here (not local to
  // one render pass) for the same reason as expandedKey above.
  let activeActivityDate: string | null = null;

  let renderToken = 0;
  const render = async (): Promise<void> => {
    const token = ++renderToken;
    const data = await loadTodayData();
    if (token !== renderToken) return;

    page.innerHTML = "";
    const children: (Node | string)[] = [];
    const banner = renderBanner(data);
    if (banner) children.push(banner);
    const mainCta = renderMainCta(data);
    children.push(renderHeaderBlock(data, render), mainCta, renderSecondaryRow(data));
    children.push(
      renderRecentWrongSection(data, {
        getExpandedKey: () => expandedKey,
        setExpandedKey: (key) => {
          expandedKey = key;
          void render();
        },
        isDismissed: (key) => dismissedThisSession.has(key),
        isToastActive: (key) => activeToastKeys.has(key),
        dismiss: (w) => {
          dismissedThisSession.add(w.key);
          activeToastKeys.add(w.key);
          void recordAnswer(w.kind as FavoriteKind, w.id, true, "anki");
          void render();

          const existingTimer = toastTimers.get(w.key);
          if (existingTimer != null) clearTimeout(existingTimer);
          toastTimers.set(
            w.key,
            setTimeout(() => {
              activeToastKeys.delete(w.key);
              toastTimers.delete(w.key);
              void render();
            }, TOAST_DURATION_MS),
          );
        },
      }),
    );
    const dailyGrammar = renderDailyGrammarSection(data);
    if (dailyGrammar) children.push(dailyGrammar);
    children.push(
      renderStatsSection(data, {
        getActiveDate: () => activeActivityDate,
        setActiveDate: (date) => {
          activeActivityDate = date;
          void render();
        },
      }),
    );
    page.append(...children);

    // Only fires the very next time /today renders after round 1 actually
    // just finished (see todayQuizEngine.ts's consumePendingCelebration) -
    // never on a routine revisit of an already-completed day.
    if (data.firstRoundResult != null && consumePendingCelebration()) {
      burstConfetti(mainCta);
    }
  };

  const unsubscribe = subscribeSrs(() => {
    render();
  });
  window.addEventListener(
    "hashchange",
    () => {
      unsubscribe();
      for (const timer of toastTimers.values()) clearTimeout(timer);
    },
    { once: true },
  );

  await render();
}

function renderBanner(data: TodayData): HTMLElement | null {
  if (data.streakBroken) {
    return el("p", { className: "today-banner" }, ["連續紀錄中斷了，今天重新開始。"]);
  }
  return null;
}

/** Greeting + countdown share one tight-spaced block (see .today-header-block)
 * instead of riding the page's normal --space-6 section rhythm - they read as
 * one "where am I, how much runway is left" unit, not two separate sections. */
function renderHeaderBlock(data: TodayData, onChange: () => void): HTMLElement {
  return el("div", { className: "today-header-block" }, [renderGreeting(data), renderCountdownRow(data, onChange)]);
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
    el("span", {}, ["N2 まで ", el("span", { className: "today-countdown-days" }, [`D-${data.days}`])]),
    el("span", {}, [`・${data.phase.label}`]),
  ]);
}

/** One card, three states it "becomes" rather than three buttons side by
 * side: 未開始 (default gradient CTA) -> 進行中 (same shape, "繼續" +
 * progress bar, once a round is left mid-way) -> 已完成 (downgrades from
 * primary action to a flat receipt, with "再練10題" as its own secondary
 * entry point - see todayQuizEngine.ts's start() for how that transparently
 * becomes a weak-fill 續攤 round). */
function renderMainCta(data: TodayData): HTMLElement {
  if (data.inProgress != null) return renderMainCtaInProgress(data.inProgress);
  if (data.firstRoundResult != null) return renderMainCtaDone(data);
  return renderMainCtaStart(data);
}

function renderMainCtaStart(data: TodayData): HTMLElement {
  const btn = el("button", { className: "today-main-cta", type: "button" }, [
    el("div", { className: "today-main-cta-text" }, [
      el("span", { className: "today-main-cta-title" }, ["今日の10問"]),
      el("span", { className: "today-main-cta-sub" }, [
        `待複習 ${data.dueCount}・弱點 ${data.weakCount}・新詞 ${data.newCount}`,
      ]),
    ]),
    el("span", { className: "today-main-cta-start" }, ["開始"]),
  ]);
  btn.addEventListener("click", () => navigate("/today/quiz"));
  return btn;
}

function renderMainCtaInProgress(progress: { currentIndex: number; total: number }): HTMLElement {
  const fill = el("div", { className: "today-main-cta-progress-fill" });
  fill.style.transform = `scaleX(${progress.currentIndex / progress.total})`;

  const btn = el("button", { className: "today-main-cta", type: "button" }, [
    el("div", { className: "today-main-cta-text" }, [
      el("span", { className: "today-main-cta-title" }, [
        `繼續・第 ${progress.currentIndex + 1}/${progress.total} 題`,
      ]),
      el("div", { className: "today-main-cta-progress-track" }, [fill]),
    ]),
    el("span", { className: "today-main-cta-start" }, ["繼續"]),
  ]);
  btn.addEventListener("click", () => navigate("/today/quiz"));
  return btn;
}

function renderMainCtaDone(data: TodayData): HTMLElement {
  const result = data.firstRoundResult!;
  const continueLink = el("button", { className: "today-main-cta-continue", type: "button" }, ["再練 10 題"]);
  continueLink.addEventListener("click", (event) => {
    event.stopPropagation();
    navigate("/today/quiz");
  });

  return el("div", { className: "today-main-cta-done" }, [
    el("div", { className: "today-main-cta-done-icon" }, [icon(TODAY_ICONS.check)]),
    el("div", { className: "today-main-cta-done-text" }, [
      el("span", { className: "today-main-cta-done-title" }, ["今日の10問 完成"]),
      el("span", { className: "today-main-cta-done-sub" }, [
        `答對 ${result.correct}/${result.total}・連續 ${data.streak} 天 🔥`,
      ]),
    ]),
    continueLink,
  ]);
}

/** Text-glyph chevron, not an inlined SVG - same deliberate exception as
 * .hub-row-chevron (game.css)/.favorite-toggle (layout.css), see those
 * comments for the icon-size cross-reference. Makes explicit that the whole
 * card is a click target, not a static label. */
function secondaryChevron(): HTMLElement {
  return el("span", { className: "today-secondary-chevron", "aria-hidden": "true" }, ["›"]);
}

/** Two static/conditional shortcut cards: 昨夜複習 (milestone 3's entry point,
 * only when yesterday introduced genuinely-tested new words) and 今日の挑戰
 * (a plain shortcut into 連連看 - no completion tracking, since that would
 * require wiring the unrelated game engine into recordAnswer). */
function renderSecondaryRow(data: TodayData): HTMLElement {
  const cards: HTMLElement[] = [];
  if (data.yesterdayNewCount > 0) {
    const card = el("button", { className: "today-secondary-card", type: "button" }, [
      icon(TODAY_ICONS.history),
      el("span", { className: "today-secondary-text" }, [
        el("span", { className: "today-secondary-title" }, ["昨夜複習"]),
        el("span", { className: "today-secondary-sub" }, [`昨天的 ${data.yesterdayNewCount} 個新詞`]),
      ]),
      secondaryChevron(),
    ]);
    card.addEventListener("click", () => navigate("/today/quiz/yesterday"));
    cards.push(card);
  }

  const challengeCard = el("button", { className: "today-secondary-card", type: "button" }, [
    icon(TODAY_ICONS.target),
    el("span", { className: "today-secondary-text" }, [
      el("span", { className: "today-secondary-title" }, ["今日の挑戰"]),
      el("span", { className: "today-secondary-sub" }, ["連連看"]),
    ]),
    secondaryChevron(),
  ]);
  challengeCard.addEventListener("click", () => navigate("/game/match"));
  cards.push(challengeCard);

  return el("div", { className: "today-secondary-row" }, cards);
}

const TOAST_DURATION_MS = 1500;

interface WrongCardHandle {
  getExpandedKey(): string | null;
  setExpandedKey(key: string | null): void;
  isDismissed(key: string): boolean;
  isToastActive(key: string): boolean;
  dismiss(w: WordState): void;
}

function renderRecentWrongSection(data: TodayData, handle: WrongCardHandle): HTMLElement {
  const title = el("p", { className: "today-section-title" }, ["最近錯詞・點一下自我檢查"]);
  if (data.recentWrong.length === 0) {
    return el("section", {}, [title, el("p", { className: "today-empty" }, ["最近沒有錯題，保持下去！"])]);
  }
  const items = data.recentWrong
    .map((w) => {
      if (!handle.isDismissed(w.key)) return renderWrongCard(w, handle);
      // Dismissed this session - shown once more as a fading confirmation,
      // then dropped from the list entirely (still filtered out here on the
      // next render once its timer clears isToastActive).
      return handle.isToastActive(w.key) ? renderDismissToast() : null;
    })
    .filter((item): item is HTMLElement => item !== null);
  const list = el("div", { className: "today-wrong-list" }, items);
  return el("section", {}, [title, list]);
}

function renderDismissToast(): HTMLElement {
  return el("div", { className: "today-wrong-toast" }, ["已記錄，但記住前可能再出現"]);
}

function renderWrongCard(w: WordState, handle: WrongCardHandle): HTMLElement {
  const store = getStoreSync();
  const expanded = handle.getExpandedKey() === w.key;

  const kindLabel = w.kind === "vocab" ? "單字" : "文法";
  let primaryText = "";
  let revealText = "";

  if (w.kind === "vocab") {
    const entry = store.vocabById.get(w.id);
    if (!entry) return el("div", {});
    primaryText = entry.kanji;
    revealText = `${entry.yomi}・${entry.meaning}`;
  } else {
    const entry = store.grammarById.get(w.id);
    if (!entry) return el("div", {});
    primaryText = entry.pattern;
    const diffNote = entry.additionalNotes?.[0]?.textZh;
    revealText = diffNote ? `${entry.meaning}・${diffNote}` : entry.meaning;
  }

  const head = el("div", { className: "today-wrong-head" }, [
    el("span", { className: "result-kind" }, [kindLabel]),
    el("span", { className: "today-wrong-primary" }, [primaryText]),
    el("span", { className: "today-wrong-count" }, [`×${recentWrongCount(w)}`]),
  ]);

  const card = el("div", { className: "today-wrong-card" }, [head]);

  if (expanded) {
    const rememberBtn = el("button", { className: "today-wrong-remember", type: "button" }, ["想起來了"]);
    rememberBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      handle.dismiss(w);
    });
    const revealRow = el("div", { className: "today-wrong-reveal-row" }, [
      el("p", { className: "today-wrong-reveal" }, [revealText]),
      rememberBtn,
    ]);
    card.append(revealRow);
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

const DAILY_GRAMMAR_NAV_DELAY_MS = 450;

/** Milestone 3's 每日一文法卡 - clicking it goes to the detail page, which
 * already calls touchWord() on mount (see grammarDetailView.ts). Bursts
 * confetti right on the card first, then navigates - a full-page route
 * swap wipes the confetti field instantly, so the burst needs a beat to
 * actually be seen before /today unmounts. */
function renderDailyGrammarSection(data: TodayData): HTMLElement | null {
  if (data.dailyGrammarId == null) return null;
  const entry = getStoreSync().grammarById.get(data.dailyGrammarId);
  if (!entry) return null;

  const card = el("div", { className: "today-daily-grammar-card", role: "button", tabindex: "0" }, [
    el("div", { className: "today-daily-grammar-head" }, [
      el("span", { className: "today-daily-grammar-pattern" }, [entry.pattern]),
      el("span", { className: "today-daily-grammar-date" }, [formatShortDate(data.today)]),
    ]),
    el("p", { className: "today-wrong-reveal" }, [entry.meaning]),
  ]);
  const open = (): void => {
    burstConfetti(card);
    setTimeout(() => navigate(`/grammar/${entry.id}`), DAILY_GRAMMAR_NAV_DELAY_MS);
  };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  return el("section", {}, [el("h2", { className: "today-section-title" }, ["每日一文法"]), card]);
}

function activityTier(stats: DailyStats | undefined): string {
  const answered = stats?.answered ?? 0;
  if (answered === 0) return "";
  if (answered < 10) return " today-activity-cell--tier1";
  if (answered < 15) return " today-activity-cell--tier2";
  return " today-activity-cell--tier3";
}

interface ActivityTooltipHandle {
  getActiveDate(): string | null;
  setActiveDate(date: string | null): void;
}

function renderStatsSection(data: TodayData, tooltip: ActivityTooltipHandle): HTMLElement {
  const activeDate = tooltip.getActiveDate();
  const cells = data.activityDays.map((d) => {
    const cell = el("button", {
      className: `today-activity-cell${activityTier(d.stats)}`,
      type: "button",
      "aria-label": `${formatShortDate(d.date)}：${d.stats?.answered ?? 0} 題`,
    });
    cell.addEventListener("click", (event) => {
      event.stopPropagation();
      tooltip.setActiveDate(activeDate === d.date ? null : d.date);
    });
    return cell;
  });
  const bar = el("div", { className: "today-activity-bar" }, cells);

  // Anchored to the bar (not the individual cell) by index-as-percentage -
  // a single tooltip element positioned along the bar's own width, clamped
  // in CSS so it can't clip off-screen for the leftmost/rightmost cells.
  const activeIndex = activeDate == null ? -1 : data.activityDays.findIndex((d) => d.date === activeDate);
  if (activeIndex >= 0) {
    const activeDay = data.activityDays[activeIndex]!;
    const answered = activeDay.stats?.answered ?? 0;
    const label =
      answered > 0
        ? `${formatShortDate(activeDay.date)}：複習 ${answered} 題`
        : `${formatShortDate(activeDay.date)}：尚無紀錄`;
    const bubble = el("div", { className: "today-activity-tooltip" }, [label]);
    const leftPct = ((activeIndex + 0.5) / data.activityDays.length) * 100;
    bubble.style.left = `clamp(38px, ${leftPct}%, calc(100% - 38px))`;
    bar.append(bubble);
  }

  const streakEl =
    data.streak > 0
      ? el("span", { className: "today-streak--fresh" }, [
          `學習紀錄・連續 ${data.streak} 天 `,
          el("span", { className: "today-streak-fire", "aria-hidden": "true" }, ["🔥"]),
        ])
      : el("span", {}, ["學習紀錄・尚未開始連續紀錄"]);

  const weekPrefix = [`本週 ${data.week.totalAnswered} 題`];
  if (data.week.accuracyPct != null) weekPrefix.push(`${data.week.accuracyPct}%`);
  const weekChildren: (Node | string)[] = [`${weekPrefix.join("・")}`];
  if (data.week.weakerCategory != null) {
    const weakLabel = data.week.weakerCategory === "grammar" ? "文法偏弱" : "單字偏弱";
    weekChildren.push("・", el("span", { className: "today-streak--fresh" }, [weakLabel]));
  }

  return el("section", { className: "today-stats" }, [
    el("div", { className: "today-stats-row" }, [streakEl, el("span", {}, weekChildren)]),
    bar,
  ]);
}
