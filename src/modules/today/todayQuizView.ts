import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { getStreak } from "./srsStore.ts";
import { TodayQuizEngine, type TodayQuizState } from "./todayQuizEngine.ts";

export function renderTodayQuizView(container: HTMLElement): void {
  container.innerHTML = "";
  const engine = new TodayQuizEngine();
  const page = el("div", { className: "quiz-page" });
  container.append(page);

  const unsubscribe = engine.subscribe((state) => {
    page.innerHTML = "";
    if (state.phase === "playing" && state.questions.length === 0) {
      page.append(el("p", { className: "quiz-hint" }, ["正在準備今天的題目…"]));
      return;
    }
    page.append(state.phase === "playing" ? renderPlaying(state, engine) : renderFinished(state, engine));
  });

  void engine.start();

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

function renderFinished(state: TodayQuizState, engine: TodayQuizEngine): HTMLElement {
  const correctCount = state.answers.filter((a) => a.correct).length;
  const total = state.answers.length;
  const wrongAnswers = state.answers.filter((a) => !a.correct);

  const streakEl = el("p", { className: "quiz-accuracy" }, ["連續天數更新中…"]);
  void getStreak().then((streak) => {
    streakEl.textContent = `連續 ${streak} 天`;
    streakEl.classList.add("today-streak--fresh");
  });

  const backBtn = el("button", { className: "btn btn--primary", type: "button" }, ["回今日"]);
  backBtn.addEventListener("click", () => navigate("/today"));

  const children: (Node | string)[] = [
    el("h1", {}, ["今天的10題"]),
    el("p", { className: "quiz-score" }, [`${total} 題中答對 ${correctCount} 題`]),
    streakEl,
  ];

  if (wrongAnswers.length > 0) {
    const items = wrongAnswers.map((a) =>
      el("div", { className: "quiz-review-item" }, [
        el("p", { className: "quiz-question" }, [a.correctLabel]),
        el("p", { className: "quiz-review-answer" }, [`正解：${a.correctText}；你選的是「${a.chosenLabel}」的語意`]),
      ]),
    );
    const retryBtn = el("button", { className: "btn btn--secondary", type: "button" }, ["錯題再測一次"]);
    retryBtn.addEventListener("click", () => engine.retryWrongOnly());
    children.push(
      el("section", { className: "quiz-review" }, [el("h3", {}, ["答錯的題目"]), ...items]),
      retryBtn,
    );
  }

  children.push(backBtn);
  return el("div", { className: "quiz-finished" }, children);
}
