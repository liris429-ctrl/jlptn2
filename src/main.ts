import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import { loadStore } from "./data/store.ts";
import { renderGrammarDetailView } from "./modules/dictionary/grammarDetailView.ts";
import { renderVocabDetailView } from "./modules/dictionary/vocabDetailView.ts";
import { renderGrammarTabView } from "./modules/dictionary/grammarTabView.ts";
import { renderVocabTabView } from "./modules/dictionary/vocabTabView.ts";
import "./modules/dictionary/dictionary.css";
import { renderGameView } from "./modules/game/gameView.ts";
import { renderGameHubView } from "./modules/game/gameHubView.ts";
import "./modules/game/game.css";
import { renderQuizView } from "./modules/quiz/quizView.ts";
import "./modules/quiz/quiz.css";
import "./modules/search/search.css";
import { renderTodayView } from "./modules/today/todayView.ts";
import { renderTodayQuizView, renderYesterdayReviewView } from "./modules/today/todayQuizView.ts";
import { openDb } from "./modules/today/db.ts";
import "./modules/today/today.css";
import { navigate, registerRoute, startRouter } from "./router.ts";
import { el } from "./utils/dom.ts";
import { NAV_ICONS } from "./utils/navIcons.ts";
import { registerServiceWorker } from "./pwa/registerSW.ts";

type TabKey = "today" | "grammar" | "vocab" | "game";

const TAB_LABELS: Record<TabKey, string> = {
  today: "今日",
  grammar: "文法",
  vocab: "單字",
  game: "日文練習",
};

function makeNavTab(icon: string, label: string): HTMLButtonElement {
  const iconWrap = el("span", { className: "nav-icon-wrap", "aria-hidden": "true" });
  iconWrap.innerHTML = icon;
  return el("button", { className: "nav-tab", type: "button" }, [
    iconWrap,
    el("span", { className: "nav-label" }, [label]),
  ]);
}

/** Mimics .result-card's shape (primary+meaning lines / star) so the first
 * paint already hints at what's coming, instead of a bare spinner. */
function renderLoadingSkeleton(container: HTMLElement, rows = 5): HTMLElement {
  const list = el(
    "div",
    { className: "skeleton-list" },
    Array.from({ length: rows }, (_, i) => {
      const row = el("div", { className: "skeleton-row" }, [
        el("span", { className: "skeleton-block skeleton-block--primary" }),
        el("span", { className: "skeleton-block skeleton-block--meaning" }),
        el("span", { className: "skeleton-block skeleton-block--star" }),
      ]);
      for (const block of row.children) (block as HTMLElement).style.animationDelay = `${i * 0.08}s`;
      return row;
    }),
  );
  container.append(list);
  return list;
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "";

  const view = el("main", { className: "app-view" });
  const nav = el("nav", { className: "app-nav" });
  const todayTab = makeNavTab(NAV_ICONS.today, "今日");
  const grammarTab = makeNavTab(NAV_ICONS.grammar, "文法");
  const vocabTab = makeNavTab(NAV_ICONS.vocab, "單字");
  const gameTab = makeNavTab(NAV_ICONS.game, "日文練習");
  todayTab.addEventListener("click", () => navigate("/today"));
  grammarTab.addEventListener("click", () => navigate("/grammar"));
  vocabTab.addEventListener("click", () => navigate("/vocab"));
  gameTab.addEventListener("click", () => navigate("/game"));
  nav.append(todayTab, grammarTab, vocabTab, gameTab);

  const titleEl = el("h1", { className: "app-title" }, ["N2たん"]);
  const header = el("header", { className: "app-header" }, [titleEl]);

  app.append(header, view, nav);

  const skeleton = renderLoadingSkeleton(view);
  await Promise.all([loadStore(), openDb()]);
  skeleton.remove();

  const setActiveTab = (tab: TabKey | null): void => {
    todayTab.classList.toggle("nav-tab--active", tab === "today");
    grammarTab.classList.toggle("nav-tab--active", tab === "grammar");
    vocabTab.classList.toggle("nav-tab--active", tab === "vocab");
    gameTab.classList.toggle("nav-tab--active", tab === "game");
    titleEl.textContent = tab ? TAB_LABELS[tab] : "N2たん";
  };

  registerRoute("/", () => {
    setActiveTab("today");
    void renderTodayView(view);
  });
  registerRoute("/today", () => {
    setActiveTab("today");
    void renderTodayView(view);
  });
  registerRoute("/today/quiz", () => {
    setActiveTab("today");
    renderTodayQuizView(view);
  });
  registerRoute("/today/quiz/yesterday", () => {
    setActiveTab("today");
    renderYesterdayReviewView(view);
  });
  registerRoute("/grammar", () => {
    setActiveTab("grammar");
    renderGrammarTabView(view);
  });
  registerRoute("/vocab", () => {
    setActiveTab("vocab");
    renderVocabTabView(view);
  });
  registerRoute("/vocab/:id", (params) => {
    setActiveTab(null);
    renderVocabDetailView(view, params);
  });
  registerRoute("/grammar/:id", (params) => {
    setActiveTab(null);
    renderGrammarDetailView(view, params);
  });
  registerRoute("/game", () => {
    setActiveTab("game");
    renderGameHubView(view);
  });
  registerRoute("/game/match", () => {
    setActiveTab("game");
    renderGameView(view);
  });
  registerRoute("/game/quiz", () => {
    setActiveTab("game");
    renderQuizView(view);
  });

  startRouter();
  registerServiceWorker();
}

main().catch((err: unknown) => {
  console.error(err);
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "<p style='padding:2rem'>読み込みに失敗しました。ページを再読み込みしてください。</p>";
});
