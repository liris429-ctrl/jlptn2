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
import { navigate, registerRoute, startRouter } from "./router.ts";
import { el } from "./utils/dom.ts";
import { NAV_ICONS } from "./utils/navIcons.ts";
import { registerServiceWorker } from "./pwa/registerSW.ts";

function makeNavTab(icon: string, label: string): HTMLButtonElement {
  const iconWrap = el("span", { className: "nav-icon-wrap", "aria-hidden": "true" });
  iconWrap.innerHTML = icon;
  return el("button", { className: "nav-tab", type: "button" }, [
    iconWrap,
    el("span", { className: "nav-label" }, [label]),
  ]);
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "";

  const view = el("main", { className: "app-view" });
  const nav = el("nav", { className: "app-nav" });
  const grammarTab = makeNavTab(NAV_ICONS.grammar, "文法");
  const vocabTab = makeNavTab(NAV_ICONS.vocab, "單字");
  const gameTab = makeNavTab(NAV_ICONS.game, "日文練習");
  grammarTab.addEventListener("click", () => navigate("/grammar"));
  vocabTab.addEventListener("click", () => navigate("/vocab"));
  gameTab.addEventListener("click", () => navigate("/game"));
  nav.append(grammarTab, vocabTab, gameTab);

  const header = el("header", { className: "app-header" }, [
    el("h1", { className: "app-title" }, ["N2たん"]),
  ]);

  app.append(header, view, nav);

  const loadingNotice = el("p", { className: "loading-notice" }, ["載入資料中…"]);
  view.append(loadingNotice);
  await loadStore();
  loadingNotice.remove();

  const setActiveTab = (path: string): void => {
    grammarTab.classList.toggle("nav-tab--active", path === "/grammar");
    vocabTab.classList.toggle("nav-tab--active", path === "/vocab");
    gameTab.classList.toggle("nav-tab--active", path.startsWith("/game"));
  };

  registerRoute("/", () => {
    setActiveTab("/grammar");
    renderGrammarTabView(view);
  });
  registerRoute("/grammar", () => {
    setActiveTab("/grammar");
    renderGrammarTabView(view);
  });
  registerRoute("/vocab", () => {
    setActiveTab("/vocab");
    renderVocabTabView(view);
  });
  registerRoute("/vocab/:id", (params) => {
    setActiveTab("");
    renderVocabDetailView(view, params);
  });
  registerRoute("/grammar/:id", (params) => {
    setActiveTab("");
    renderGrammarDetailView(view, params);
  });
  registerRoute("/game", () => {
    setActiveTab("/game");
    renderGameHubView(view);
  });
  registerRoute("/game/match", () => {
    setActiveTab("/game");
    renderGameView(view);
  });
  registerRoute("/game/quiz", () => {
    setActiveTab("/game");
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
