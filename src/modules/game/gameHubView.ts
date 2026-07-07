import { navigate } from "../../router.ts";
import { el } from "../../utils/dom.ts";
import { NAV_ICONS } from "../../utils/navIcons.ts";

interface HubOption {
  icon: string;
  title: string;
  subtitle: string;
  path: string;
}

const OPTIONS: HubOption[] = [
  { icon: NAV_ICONS.game, title: "單字消消樂", subtitle: "日中配對，訓練反應力", path: "/game/match" },
  { icon: NAV_ICONS.quiz, title: "實戰考題", subtitle: "歷屆考題，即測即解", path: "/game/quiz" },
];

export function renderGameHubView(container: HTMLElement): void {
  container.innerHTML = "";
  const rows = OPTIONS.map((option) => renderHubRow(option));
  container.append(el("div", { className: "hub-page" }, rows));
}

function renderHubRow(option: HubOption): HTMLElement {
  const icon = el("span", { className: "hub-row-icon", "aria-hidden": "true" });
  icon.innerHTML = option.icon;

  const text = el("div", { className: "hub-row-text" }, [
    el("p", { className: "hub-row-title" }, [option.title]),
    el("p", { className: "hub-row-subtitle" }, [option.subtitle]),
  ]);

  const chevron = el("span", { className: "hub-row-chevron", "aria-hidden": "true" }, ["›"]);

  const row = el(
    "div",
    { className: "hub-row", role: "button", tabindex: "0" },
    [icon, text, chevron],
  );
  row.addEventListener("click", () => navigate(option.path));
  row.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(option.path);
    }
  });
  return row;
}
