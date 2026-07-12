const TOAST_DURATION_MS = 1800;

/**
 * Lightweight, auto-dismissing confirmation - same fading-toast language as
 * today.css's .today-weak-toast, generalized here since more than one
 * unrelated page needs the same "did that" confirmation without a full
 * modal (this app has no modal component).
 */
export function showToast(message: string): void {
  const el = document.createElement("div");
  el.className = "app-toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), TOAST_DURATION_MS);
}
