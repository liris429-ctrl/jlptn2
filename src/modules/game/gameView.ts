import { el } from "../../utils/dom.ts";
import { GameEngine, ROUND_SECONDS, type Cell, type GameState } from "./gameEngine.ts";

export function renderGameView(container: HTMLElement): void {
  container.innerHTML = "";
  const engine = new GameEngine();

  const statusBar = el("div", { className: "game-status" });
  const grid = el("div", { className: "game-grid" });
  const overlay = el("div", { className: "game-overlay" });
  const page = el("div", { className: "game-page" }, [statusBar, grid, overlay]);
  container.append(page);

  const unsubscribe = engine.subscribe((state) => render(state));

  function render(state: GameState): void {
    renderStatusBar(statusBar, state, () => engine.start());
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

function renderStatusBar(container: HTMLElement, state: GameState, onRestart: () => void): void {
  container.innerHTML = "";
  const restartBtn = el("button", { className: "game-restart", type: "button" }, ["重新開始"]);
  restartBtn.addEventListener("click", onRestart);

  const statsRow = el("div", { className: "game-status-row" }, [
    el("span", { className: "game-timer" }, [`${state.timeRemaining}s`]),
    el("span", { className: "game-score" }, [`消除 ${state.sessionTotalMatches}`]),
    el("span", { className: `game-combo${comboTierClass(state.combo)}` }, [`Combo ×${state.combo}`]),
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

  container.append(
    el("div", { className: "game-result" }, [
      el("h2", {}, ["時間到！"]),
      el("p", {}, [`總消除數：${state.sessionTotalMatches}`]),
      el("p", {}, [`最高 Combo：${state.maxCombo}`]),
      el("p", {}, [`正確率：${accuracy}%`]),
      again,
    ]),
  );
}
