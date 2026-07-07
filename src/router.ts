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

export function navigate(path: string): void {
  if (currentPath() === path) render();
  else location.hash = path;
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}
