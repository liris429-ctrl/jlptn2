type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  segments: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

export function registerRoute(pattern: string, handler: RouteHandler): void {
  routes.push({ segments: pattern.split("/").filter(Boolean), handler });
}

function matchRoute(
  path: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  const segments = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < route.segments.length; i++) {
      const routeSegment = route.segments[i]!;
      if (routeSegment.startsWith(":")) {
        params[routeSegment.slice(1)] = decodeURIComponent(segments[i]!);
      } else if (routeSegment !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: route.handler, params };
  }
  return null;
}

function currentPath(): string {
  return location.hash.slice(1) || "/";
}

function render(): void {
  const match = matchRoute(currentPath());
  if (match) {
    match.handler(match.params);
  } else {
    navigate("/");
  }
}

let guard: (() => boolean) | null = null;

/**
 * Lets a view veto in-app navigation away from itself (e.g. mid-quiz progress
 * that would otherwise be silently lost). Only intercepts calls to navigate() -
 * i.e. taps on the bottom nav bar, which is the only way to move between views
 * in this installed-PWA app (no visible browser back/forward chrome in
 * standalone mode). A view must call setNavigationGuard(null) on its own
 * cleanup so a stale guard never blocks navigation after it has unmounted.
 */
export function setNavigationGuard(fn: (() => boolean) | null): void {
  guard = fn;
}

export function navigate(path: string): void {
  if (currentPath() === path) {
    render();
    return;
  }
  if (guard && !guard()) return;
  location.hash = path;
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}
