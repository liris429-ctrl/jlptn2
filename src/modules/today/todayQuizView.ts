import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { getStreak, getYesterdayNewWords } from "./srsStore.ts";
import { TodayQuizEngine, type TodayQuizState } from "./todayQuizEngine.ts";
import { TODAY_ICONS } from "./todayIcons.ts";

function mountQuizView(
  container: HTMLElement,
  title: string,
  start: (engine: TodayQuizEngine) => void | Promise<void>,
): void {
  container.innerHTML = "";
  const engine = new TodayQuizEngine();
  const page = el("div", { className: "quiz-page" });
  container.append(page);

  const unsubscribe = engine.subscribe((state) => {
    page.innerHTML = "";
    if (state.phase === "playing" && state.questions.length === 0) {
      page.append(el("p", { className: "quiz-hint" }, ["正在準備題目…"]));
      return;
    }
    page.append(state.phase === "playing" ? renderPlaying(state, engine) : renderFinished(state, engine, title));
  });

  // Without this, an unexpected failure (e.g. IndexedDB error) would leave
  // the "正在準備題目…" hint above showing forever with no feedback - the
  // engine never gets a chance to emit a real state past its initial one.
  Promise.resolve(start(engine)).catch((err: unknown) => {
    console.error(err);
    page.innerHTML = "";
    page.append(
      el("p", { className: "quiz-hint" }, ["題目準備失敗，請返回今日重新整理再試一次。"]),
    );
  });

  // Deliberately no setNavigationGuard/beforeunload here (unlike the older
  // 實戰考題 quizView.ts): every answer is already durably written via
  // recordAnswer as it happens, so leaving mid-round only discards the
  // round's position, which the spec explicitly says is fine to lose.
  const cleanup = (): void => {
    engine.stop();
    unsubscribe();
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup, { once: true });
}

export function renderTodayQuizView(container: HTMLElement): void {
  mountQuizView(container, "今日學習任務", (engine) => engine.start());
}

/** Milestone 3's 昨夜複習 mini-quiz: only the previous day's genuinely-tested
 * new words (see getYesterdayNewWords' lookup-only filter), no pool ratio or
 * grammar-minimum rules, answers still flow through the normal source="quiz"
 * recordAnswer path inside selectOption(). */
export function renderYesterdayReviewView(container: HTMLElement): void {
  mountQuizView(container, "昨夜複習", async (engine) => {
    const words = await getYesterdayNewWords();
    engine.startWithWords(words.map((w) => ({ kind: w.kind, id: w.id })));
  });
}

function renderPlaying(state: TodayQuizState, engine: TodayQuizEngine): HTMLElement {
  const question = state.questions[state.currentIndex]!;
  const answered = state.selectedIndex !== null;

  const optionButtons = question.options.map((option, index) => {
    const btn = el("button", { className: "quiz-option", type: "button" }, [option.text]);
    if (answered) {
      btn.setAttribute("disabled", "true");
      if (index === question.answerIndex) btn.classList.add("quiz-option--correct");
      else if (index === state.selectedIndex) btn.classList.add("quiz-option--wrong");
      else btn.classList.add("quiz-option--dim");
    } else {
      btn.addEventListener("click", () => engine.selectOption(index));
    }
    return btn;
  });

  const children: (Node | string)[] = [
    el("p", { className: "quiz-progress" }, [`第 ${state.currentIndex + 1} / ${state.questions.length} 題`]),
    el("p", { className: "quiz-question" }, [question.stem]),
    el("div", { className: "quiz-options" }, optionButtons),
  ];

  // Always shown once answered (not just on a wrong pick) - the feedback line
  // also names which real word a wrong pick's meaning actually belongs to.
  if (answered) {
    const record = state.answers[state.answers.length - 1]!;
    const feedback = record.correct
      ? `${record.correctLabel} = ${record.correctText}`
      : `${record.correctLabel} = ${record.correctText}；你選的是「${record.chosenLabel}」的語意`;
    children.push(el("p", { className: "quiz-explanation" }, [feedback]));
  }

  return el("div", { className: "quiz-playing" }, children);
}

/** Renders the exhausted/"nothing left to practice" message in place of a
 * continue action - the pool's natural boundary, not a hard round cap, so it
 * reads as "you've earned a break" rather than an error or a wall. */
function renderExhausted(): HTMLElement {
  const link = el("a", { className: "quiz-exhausted-link" }, ["去玩個連連看放鬆一下？"]);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigate("/game/match");
  });
  const icon = el("span", { className: "quiz-exhausted-icon", "aria-hidden": "true" });
  icon.innerHTML = TODAY_ICONS.thumbUp;
  return el("div", { className: "quiz-exhausted" }, [
    icon,
    el("p", { className: "quiz-exhausted-text" }, ["今天的弱點都過一輪了"]),
    link,
  ]);
}

/** Round 1's finished screen: the once-a-day celebration (big score, streak
 * pill) plus a full wrong-answer review. Its continue action is synchronous
 * when there are wrongs to retry (no weak-pool padding - see
 * retryWrongOnly()); only the wrong===0 fallback needs an async preview. */
function renderMainFinished(state: TodayQuizState, engine: TodayQuizEngine, title: string): HTMLElement {
  const correctCount = state.answers.filter((a) => a.correct).length;
  const total = state.answers.length;
  const wrongAnswers = state.answers.filter((a) => !a.correct);

  const streakBadge = el("div", { className: "quiz-streak-badge" }, ["🔥 連續天數更新中…"]);
  void getStreak().then((streak) => {
    streakBadge.textContent = "";
    streakBadge.append("🔥 ", el("span", {}, [`連續 ${streak} 天`]));
  });

  const backBtn = el("button", { className: "btn btn--secondary", type: "button" }, ["回今日"]);
  backBtn.addEventListener("click", () => navigate("/today"));

  const actionArea = el("div", { className: "quiz-finished-action" });
  if (wrongAnswers.length > 0) {
    const retryBtn = el("button", { className: "btn btn--primary", type: "button" }, [
      `再練這 ${wrongAnswers.length} 個錯題`,
    ]);
    retryBtn.addEventListener("click", () => engine.retryWrongOnly());
    actionArea.append(retryBtn);
  } else {
    void engine.previewContinueCount().then((count) => {
      actionArea.innerHTML = "";
      if (count === 0) {
        actionArea.append(renderExhausted());
        return;
      }
      const continueBtn = el("button", { className: "btn btn--primary", type: "button" }, [`再練 ${count} 個弱點`]);
      continueBtn.addEventListener("click", () => void engine.continueRound());
      actionArea.append(continueBtn);
    });
  }

  const children: (Node | string)[] = [
    el("p", { className: "quiz-round1-label" }, [title, " 完成"]),
    el("p", { className: "quiz-round1-score" }, [`${correctCount}`, el("span", {}, [`/${total}`])]),
    streakBadge,
  ];

  if (wrongAnswers.length > 0) {
    const items = wrongAnswers.map((a) =>
      el("div", { className: "quiz-review-item" }, [
        el("p", { className: "quiz-question" }, [a.correctLabel]),
        el("p", { className: "quiz-review-answer" }, [`正解：${a.correctText}；你選的是「${a.chosenLabel}」的語意`]),
      ]),
    );
    children.push(el("section", { className: "quiz-review" }, [el("h3", {}, ["答錯的題目"]), ...items]));
  }

  children.push(el("div", { className: "quiz-finished-actions" }, [backBtn, actionArea]));
  return el("div", { className: "quiz-finished quiz-finished--main" }, children);
}

/** Any 續攤 round's finished screen: deliberately subdued (no big number, no
 * streak/fire - that celebration is round 1's alone) - just the score and an
 * honest, shrinking "再練 N 個" continue action, or the exhausted message
 * once the pool runs dry. */
function renderExtraFinished(state: TodayQuizState, engine: TodayQuizEngine): HTMLElement {
  const correctCount = state.answers.filter((a) => a.correct).length;
  const total = state.answers.length;

  const actionArea = el("div", { className: "quiz-continue-area" }, ["…"]);
  void engine.previewContinueCount().then((count) => {
    actionArea.innerHTML = "";
    if (count === 0) {
      actionArea.append(renderExhausted());
      return;
    }
    const continueBtn = el("button", { className: "quiz-continue-chip", type: "button" }, [`再練 ${count} 個`]);
    continueBtn.addEventListener("click", () => void engine.continueRound());
    actionArea.append(continueBtn);
  });

  const summaryRow = el("div", { className: "quiz-extra-summary-row" }, [
    el("span", {}, ["這輪答對 ", el("strong", {}, [`${correctCount}/${total}`])]),
  ]);
  summaryRow.append(actionArea);

  return el("div", { className: "quiz-finished quiz-finished--extra" }, [summaryRow]);
}

function renderFinished(state: TodayQuizState, engine: TodayQuizEngine, title: string): HTMLElement {
  // The round genuinely had nothing to quiz (empty pool, or every drawn id
  // failed to resolve) - distinct from "answered 0 of a real round", which
  // can't happen since selectOption() is the only way to reach "finished"
  // with questions.length > 0. Round 1 coming up empty is a different,
  // rarer situation (new-user/data-poor) from an "extra" round's pool
  // simply running dry, so they get different copy.
  if (state.questions.length === 0) {
    if (state.roundKind === "extra") {
      return el("div", { className: "quiz-finished quiz-finished--extra" }, [renderExhausted()]);
    }
    const backBtn = el("button", { className: "btn btn--primary", type: "button" }, ["回今日"]);
    backBtn.addEventListener("click", () => navigate("/today"));
    return el("div", { className: "quiz-finished" }, [
      el("h1", {}, [title]),
      el("p", { className: "quiz-hint" }, ["目前沒有可出的題目，去瀏覽幾個單字或文法後再回來試試。"]),
      backBtn,
    ]);
  }

  return state.roundKind === "main"
    ? renderMainFinished(state, engine, title)
    : renderExtraFinished(state, engine);
}
