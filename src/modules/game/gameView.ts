import { getStoreSync } from "../../data/store.ts";
import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { GameEngine, ROUND_SECONDS, type Cell, type GameState } from "./gameEngine.ts";

const WRONG_LIST_MAX = 8;

export function renderGameView(container: HTMLElement): void {
  container.innerHTML = "";
  const engine = new GameEngine();

  const statusBar = el("div", { className: "game-status" });
  const grid = el("div", { className: "game-grid" });
  const overlay = el("div", { className: "game-overlay" });
  const page = el("div", { className: "game-page" }, [statusBar, grid, overlay]);
  container.append(page);

  let previousCombo = 0;
  const unsubscribe = engine.subscribe((state) => render(state));

  function render(state: GameState): void {
    renderStatusBar(statusBar, state, previousCombo, () => engine.start());
    previousCombo = state.combo;
    renderGrid(grid, state, (cellId) => engine.selectCell(cellId));
    renderOverlay(overlay, state, () => engine.start());
  }

  engine.start();

  // Stop the round timer if the user navigates to another view.
  const cleanup = (): void => {
    engine.stop();
    unsubscribe();
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup, { once: true });
}

/** Escalating warm-orange emphasis as combo climbs, reusing --accent (no new hues). */
function comboTierClass(combo: number): string {
  if (combo >= 6) return " game-combo--tier3";
  if (combo >= 4) return " game-combo--tier2";
  if (combo >= 2) return " game-combo--tier1";
  return "";
}

/** Milestone every 5th combo (5, 10, 15...) gets a bigger, glowing pop than a normal tick. */
function comboPopClass(combo: number, previousCombo: number): string {
  if (combo <= previousCombo || combo <= 0) return "";
  return combo % 5 === 0 ? " game-combo--milestone" : " game-combo--pop";
}

function renderStatusBar(
  container: HTMLElement,
  state: GameState,
  previousCombo: number,
  onRestart: () => void,
): void {
  container.innerHTML = "";
  const restartBtn = el("button", { className: "game-restart", type: "button" }, ["重新開始"]);
  restartBtn.addEventListener("click", onRestart);

  const comboClass = `game-combo${comboTierClass(state.combo)}${comboPopClass(state.combo, previousCombo)}`;
  const statsRow = el("div", { className: "game-status-row" }, [
    el("span", { className: "game-timer" }, [`${state.timeRemaining}s`]),
    el("span", { className: "game-score" }, [`消除 ${state.sessionTotalMatches}`]),
    el("span", { className: comboClass }, [`Combo ×${state.combo}`]),
    restartBtn,
  ]);

  const progressPct = Math.max(0, Math.min(100, (state.timeRemaining / ROUND_SECONDS) * 100));
  const progressFill = el("div", { className: "game-progress-fill" });
  progressFill.style.width = `${progressPct}%`;
  const progressTrack = el("div", { className: "game-progress-track" }, [progressFill]);

  container.append(statsRow, progressTrack);
}

function renderGrid(container: HTMLElement, state: GameState, onSelect: (cellId: string) => void): void {
  container.innerHTML = "";
  for (const cell of state.grid) {
    container.append(renderCell(cell, onSelect));
  }
}

function lengthTier(text: string): "sm" | "md" | "lg" {
  if (text.length > 8) return "lg";
  if (text.length > 4) return "md";
  return "sm";
}

function renderCell(cell: Cell, onSelect: (cellId: string) => void): HTMLElement {
  const text = el("span", { className: "game-cell-text" }, [cell.display]);
  const button = el(
    "button",
    {
      className: `game-cell game-cell--${cell.kind} game-cell--${cell.state} game-cell--len-${lengthTier(cell.display)}`,
      type: "button",
    },
    [text],
  );
  if (cell.state === "matched") button.setAttribute("disabled", "true");
  button.addEventListener("click", () => onSelect(cell.cellId));
  return button;
}

function renderWrongWordList(vocabIds: string[]): HTMLElement | null {
  if (vocabIds.length === 0) return null;
  const store = getStoreSync();
  const entries = vocabIds
    .map((id) => store.vocabById.get(id))
    .filter((v): v is NonNullable<typeof v> => v !== undefined);
  if (entries.length === 0) return null;

  const shown = entries.slice(0, WRONG_LIST_MAX);
  const chips = shown.map((entry) => {
    const chip = el("button", { className: "chip chip--vocab", type: "button" }, [
      `${entry.kanji} ${entry.meaning}`,
    ]);
    chip.addEventListener("click", () => navigate(`/vocab/${entry.id}`));
    return chip;
  });

  const children: (Node | string)[] = [el("div", { className: "chip-row" }, chips)];
  if (entries.length > WRONG_LIST_MAX) {
    children.push(el("p", { className: "game-result-more" }, [`還有 ${entries.length - WRONG_LIST_MAX} 個…`]));
  }

  return el("div", { className: "game-wrong-words" }, [el("h3", {}, ["本輪答錯的詞"]), ...children]);
}

function renderOverlay(container: HTMLElement, state: GameState, onRestart: () => void): void {
  container.innerHTML = "";
  container.classList.toggle("game-overlay--visible", state.phase === "gameOver");
  if (state.phase !== "gameOver") return;

  const accuracy = state.sessionTotalMatches + state.sessionWrong > 0
    ? Math.round((state.sessionTotalMatches / (state.sessionTotalMatches + state.sessionWrong)) * 100)
    : 100;

  const again = el("button", { className: "game-restart game-restart--primary", type: "button" }, [
    "再玩一次",
  ]);
  again.addEventListener("click", onRestart);

  const resultChildren: (Node | string)[] = [
    el("h2", {}, ["時間到！"]),
    el("p", {}, [`總消除數：${state.sessionTotalMatches}`]),
    el("p", {}, [`最高 Combo：${state.maxCombo}`]),
    el("p", {}, [`正確率：${accuracy}%`]),
  ];
  const wrongList = renderWrongWordList(state.wrongVocabIds);
  if (wrongList) resultChildren.push(wrongList);
  resultChildren.push(again);

  container.append(el("div", { className: "game-result" }, resultChildren));
}
