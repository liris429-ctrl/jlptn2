import type { VocabEntry } from "../../data/schema.ts";
import { getStoreSync } from "../../data/store.ts";
import { firstClause } from "../../utils/text.ts";
import { shuffle } from "./shuffle.ts";

export type CellState = "idle" | "selected" | "matched" | "wrong-flash";
export type CellKind = "jp" | "zh";

export interface Cell {
  cellId: string;
  vocabId: string;
  display: string;
  kind: CellKind;
  state: CellState;
}

export type GamePhase = "idle" | "playing" | "gameOver";

export interface GameState {
  phase: GamePhase;
  grid: Cell[];
  selectedCellId: string | null;
  matchesThisRound: number;
  sessionTotalMatches: number;
  sessionWrong: number;
  combo: number;
  maxCombo: number;
  timeRemaining: number;
  /** Distinct vocab ids that were part of at least one mismatched pair this session. */
  wrongVocabIds: string[];
}

export const ROUND_SECONDS = 30;
export const PAIRS_PER_ROUND = 8;
const WRONG_FLASH_MS = 500;

/**
 * Different words can collapse to the same displayed Chinese clause (e.g. 支払い
 * (noun) and 支払う (verb) both show "支付,付款", or true synonyms like あっち/そっち).
 * If both landed in the same round, their zh cells would read identically with no
 * way to tell which jp cell they pair with - a real fairness bug, not cosmetic.
 * Picking greedily while skipping meaning-clause repeats guarantees every zh cell
 * in a round is textually distinct.
 */
function pickUniqueByMeaning(pool: readonly VocabEntry[], count: number): VocabEntry[] {
  const shuffled = shuffle(pool);
  const picked: VocabEntry[] = [];
  const seenMeanings = new Set<string>();
  for (const v of shuffled) {
    if (picked.length >= count) break;
    const clause = firstClause(v.meaning);
    if (seenMeanings.has(clause)) continue;
    seenMeanings.add(clause);
    picked.push(v);
  }
  // Defensive fallback for a pool too small to fill `count` unique-meaning slots
  // (won't happen in practice - thousands of eligible words) so a round never
  // silently comes up short.
  if (picked.length < count) {
    for (const v of shuffled) {
      if (picked.length >= count) break;
      if (!picked.includes(v)) picked.push(v);
    }
  }
  return picked;
}

type Listener = (state: GameState) => void;

export class GameEngine {
  private state: GameState = GameEngine.initialState();
  private listeners = new Set<Listener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private wrongFlashHandle: ReturnType<typeof setTimeout> | null = null;
  private usedVocabIds = new Set<string>();

  private static initialState(): GameState {
    return {
      phase: "idle",
      grid: [],
      selectedCellId: null,
      matchesThisRound: 0,
      sessionTotalMatches: 0,
      sessionWrong: 0,
      combo: 0,
      maxCombo: 0,
      timeRemaining: ROUND_SECONDS,
      wrongVocabIds: [],
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  start(): void {
    this.stopTimer();
    this.clearWrongFlashTimer();
    this.usedVocabIds.clear();
    this.state = { ...GameEngine.initialState(), phase: "playing", grid: this.drawGrid() };
    this.emit();
    this.tickHandle = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.stopTimer();
    this.clearWrongFlashTimer();
  }

  private drawGrid(): Cell[] {
    const store = getStoreSync();
    // Exclude words flagged as visually near-identical to their own Chinese
    // meaning (e.g. 電子/电子) - matching them is a freebie with no training value.
    // The vocab library now spans N1-N5 (see v9); 連連看 stays N2-only by default
    // to match the app's existing focus - no in-game level picker yet.
    const eligible = store.vocab.filter((v) => !v.gameExcluded && v.jlptLevel === "N2");
    const unseen = eligible.filter((v) => !this.usedVocabIds.has(v.id));
    const pool = unseen.length >= PAIRS_PER_ROUND ? unseen : eligible;
    const picked = pickUniqueByMeaning(pool, PAIRS_PER_ROUND);
    for (const v of picked) this.usedVocabIds.add(v.id);

    const cells: Cell[] = [];
    picked.forEach((v: VocabEntry, i: number) => {
      cells.push({ cellId: `jp-${i}-${v.id}`, vocabId: v.id, display: v.kanji, kind: "jp", state: "idle" });
      cells.push({
        cellId: `zh-${i}-${v.id}`,
        vocabId: v.id,
        display: firstClause(v.meaning),
        kind: "zh",
        state: "idle",
      });
    });
    return shuffle(cells);
  }

  private tick(): void {
    if (this.state.phase !== "playing") return;
    const timeRemaining = this.state.timeRemaining - 1;
    if (timeRemaining <= 0) {
      this.state = { ...this.state, timeRemaining: 0, phase: "gameOver" };
      this.stopTimer();
    } else {
      this.state = { ...this.state, timeRemaining };
    }
    this.emit();
  }

  selectCell(cellId: string): void {
    if (this.state.phase !== "playing") return;
    if (this.wrongFlashHandle) this.resolveWrongFlash();

    const cell = this.state.grid.find((c) => c.cellId === cellId);
    if (!cell || cell.state === "matched") return;

    if (!this.state.selectedCellId) {
      this.applyCellState(cellId, "selected");
      this.state = { ...this.state, selectedCellId: cellId };
      this.emit();
      return;
    }
    if (this.state.selectedCellId === cellId) return;

    const first = this.state.grid.find((c) => c.cellId === this.state.selectedCellId)!;
    if (first.vocabId === cell.vocabId && first.kind !== cell.kind) {
      this.applyCellState(first.cellId, "matched");
      this.applyCellState(cellId, "matched");
      const matchesThisRound = this.state.matchesThisRound + 1;
      const combo = this.state.combo + 1;
      const refill = matchesThisRound >= PAIRS_PER_ROUND;
      this.state = {
        ...this.state,
        selectedCellId: null,
        matchesThisRound: refill ? 0 : matchesThisRound,
        sessionTotalMatches: this.state.sessionTotalMatches + 1,
        combo,
        maxCombo: Math.max(this.state.maxCombo, combo),
        grid: refill ? this.drawGrid() : this.state.grid,
      };
      this.emit();
    } else {
      this.applyCellState(first.cellId, "wrong-flash");
      this.applyCellState(cellId, "wrong-flash");
      const wrongIds = new Set(this.state.wrongVocabIds);
      wrongIds.add(first.vocabId);
      wrongIds.add(cell.vocabId);
      this.state = {
        ...this.state,
        selectedCellId: null,
        combo: 0,
        sessionWrong: this.state.sessionWrong + 1,
        wrongVocabIds: [...wrongIds],
      };
      this.emit();
      this.wrongFlashHandle = setTimeout(() => this.resolveWrongFlash(), WRONG_FLASH_MS);
    }
  }

  private resolveWrongFlash(): void {
    this.state = {
      ...this.state,
      grid: this.state.grid.map((c) => (c.state === "wrong-flash" ? { ...c, state: "idle" } : c)),
    };
    this.wrongFlashHandle = null;
    this.emit();
  }

  private applyCellState(cellId: string, state: CellState): void {
    this.state = {
      ...this.state,
      grid: this.state.grid.map((c) => (c.cellId === cellId ? { ...c, state } : c)),
    };
  }

  private stopTimer(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private clearWrongFlashTimer(): void {
    if (this.wrongFlashHandle) {
      clearTimeout(this.wrongFlashHandle);
      this.wrongFlashHandle = null;
    }
  }
}
