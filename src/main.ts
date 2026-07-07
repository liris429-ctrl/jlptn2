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
import "./modules/game/game.css";
import "./modules/search/search.css";
import { navigate, registerRoute, startRouter } from "./router.ts";
import { el } from "./utils/dom.ts";
import { registerServiceWorker } from "./pwa/registerSW.ts";

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "";

  const view = el("main", { className: "app-view" });
  const nav = el("nav", { className: "app-nav" });
  const grammarTab = el("button", { className: "nav-tab", type: "button" }, ["文法"]);
  const vocabTab = el("button", { className: "nav-tab", type: "button" }, ["單字"]);
  const gameTab = el("button", { className: "nav-tab", type: "button" }, ["連連看"]);
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
    gameTab.classList.toggle("nav-tab--active", path === "/game");
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
    renderGameView(view);
  });

  startRouter();
  registerServiceWorker();
}

main().catch((err: unknown) => {
  console.error(err);
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "<p style='padding:2rem'>読み込みに失敗しました。ページを再読み込みしてください。</p>";
});
