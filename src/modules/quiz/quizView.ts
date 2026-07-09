import { setNavigationGuard } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { QuizEngine, type QuizPhase, type QuizState } from "./quizEngine.ts";

const COUNT_OPTIONS = [5, 10, 20];
const DEFAULT_COUNT = 10;
const LEAVE_CONFIRM_MESSAGE = "測驗還沒作答完，離開後這次的作答記錄不會保留，確定要離開嗎？";

export function renderQuizView(container: HTMLElement): void {
  container.innerHTML = "";
  const engine = new QuizEngine();
  const page = el("div", { className: "quiz-page" });
  container.append(page);

  let phase: QuizPhase = "setup";
  const unsubscribe = engine.subscribe((state) => {
    phase = state.phase;
    page.innerHTML = "";
    if (state.phase === "setup") page.append(renderSetup(engine));
    else if (state.phase === "playing") page.append(renderPlaying(state, engine));
    else page.append(renderFinished(state, engine));
  });

  // Only mid-quiz progress is worth protecting - nothing to lose yet on the
  // setup screen, and the finished screen's result is already visible/final.
  setNavigationGuard(() => phase !== "playing" || confirm(LEAVE_CONFIRM_MESSAGE));
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (phase !== "playing") return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);

  const cleanup = (): void => {
    setNavigationGuard(null);
    window.removeEventListener("beforeunload", beforeUnload);
    unsubscribe();
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup, { once: true });
}

function renderSetup(engine: QuizEngine): HTMLElement {
  const available = QuizEngine.availableCount();
  let selectedCount = DEFAULT_COUNT;

  const countButtons = new Map<number, HTMLButtonElement>();
  const countRow = el(
    "div",
    { className: "quiz-count-row" },
    COUNT_OPTIONS.map((count) => {
      const btn = el("button", { className: "chip filter-toggle", type: "button" }, [`${count} 題`]);
      btn.classList.toggle("filter-toggle--active", count === selectedCount);
      btn.addEventListener("click", () => {
        selectedCount = count;
        for (const [c, b] of countButtons) b.classList.toggle("filter-toggle--active", c === selectedCount);
      });
      countButtons.set(count, btn);
      return btn;
    }),
  );

  const startBtn = el("button", { className: "btn btn--primary", type: "button" }, [
    "開始測驗",
  ]);
  if (available === 0) {
    startBtn.setAttribute("disabled", "true");
  } else {
    startBtn.addEventListener("click", () => engine.start(selectedCount));
  }

  return el("div", { className: "quiz-setup" }, [
    el("h1", {}, ["實戰考題"]),
    el("p", { className: "quiz-hint" }, [
      available === 0
        ? "目前還沒有題庫，晚點再回來看看"
        : `目前題庫共 ${available} 題，選的題數超過題庫時會抽取全部題目`,
    ]),
    countRow,
    startBtn,
  ]);
}

function renderPlaying(state: QuizState, engine: QuizEngine): HTMLElement {
  const question = state.questions[state.currentIndex]!;
  const confirmed = state.confirmedIndex !== null;

  const optionButtons = question.options.map((option, index) => {
    const btn = el("button", { className: "quiz-option", type: "button" }, [option]);
    if (confirmed) {
      btn.setAttribute("disabled", "true");
      if (index === question.answer) btn.classList.add("quiz-option--correct");
      else if (index === state.confirmedIndex) btn.classList.add("quiz-option--wrong");
      else btn.classList.add("quiz-option--dim");
    } else {
      if (index === state.pendingIndex) btn.classList.add("quiz-option--pending");
      btn.addEventListener("click", () => engine.pickOption(index));
    }
    return btn;
  });

  const children: (Node | string)[] = [
    el("p", { className: "quiz-progress" }, [`第 ${state.currentIndex + 1} / ${state.questions.length} 題`]),
    el("span", { className: "jlpt-badge" }, [question.source]),
    el("p", { className: "quiz-question" }, [question.question]),
    el("div", { className: "quiz-options" }, optionButtons),
  ];

  if (!confirmed) {
    // Pending pick still needs an explicit 確定 tap - grading/explanation/next
    // only appear after that, so a stray click can't accidentally submit an answer.
    const confirmBtn = el("button", { className: "btn btn--primary", type: "button" }, ["確定"]);
    if (state.pendingIndex === null) confirmBtn.setAttribute("disabled", "true");
    else confirmBtn.addEventListener("click", () => engine.confirmAnswer());
    children.push(confirmBtn);
  } else {
    if (question.explanation) {
      children.push(el("div", { className: "quiz-explanation" }, [question.explanation]));
    }
    const isLast = state.currentIndex === state.questions.length - 1;
    const nextBtn = el("button", { className: "btn btn--primary", type: "button" }, [
      isLast ? "查看結果" : "下一題",
    ]);
    nextBtn.addEventListener("click", () => engine.next());
    children.push(nextBtn);
  }

  return el("div", { className: "quiz-playing" }, children);
}

function renderFinished(state: QuizState, engine: QuizEngine): HTMLElement {
  const correctCount = state.answers.filter((a) => a.correct).length;
  const total = state.answers.length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const wrongAnswers = state.answers.filter((a) => !a.correct);

  const restartBtn = el("button", { className: "btn btn--primary", type: "button" }, [
    "重新測驗",
  ]);
  restartBtn.addEventListener("click", () => engine.reset());

  const children: (Node | string)[] = [
    el("h1", {}, ["測驗結果"]),
    el("p", { className: "quiz-score" }, [`${total} 題中答對 ${correctCount} 題`]),
    el("p", { className: "quiz-accuracy" }, [`正確率：${accuracy}%`]),
  ];

  if (wrongAnswers.length > 0) {
    const items = wrongAnswers.map((a) => {
      const question = state.questions.find((q) => q.id === a.questionId)!;
      return el("div", { className: "quiz-review-item" }, [
        el("p", { className: "quiz-question" }, [question.question]),
        el("p", { className: "quiz-review-answer" }, [
          `你選了「${question.options[a.selectedIndex]}」，正解是「${question.options[question.answer]}」`,
        ]),
        ...(question.explanation
          ? [el("p", { className: "quiz-explanation" }, [question.explanation])]
          : []),
      ]);
    });
    children.push(el("section", { className: "quiz-review" }, [el("h3", {}, ["答錯的題目"]), ...items]));
  }

  children.push(restartBtn);
  return el("div", { className: "quiz-finished" }, children);
}
