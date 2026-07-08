/**
 * Pure windowing math, split out from the DOM-touching renderer below purely so
 * it's unit-testable without a real layout engine (jsdom/happy-dom always
 * report 0 from getBoundingClientRect, so the interesting logic has to live
 * somewhere that doesn't depend on it).
 */
export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  totalCount: number,
  overscan: number,
): [start: number, end: number] {
  if (totalCount === 0 || itemHeight <= 0) return [0, 0];
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const end = Math.min(totalCount, start + visibleCount);
  return [start, end];
}

export interface VirtualListHandle {
  destroy(): void;
}

const OVERSCAN = 6;

/**
 * Fixed-height virtual list: only the rows near the current scroll position are
 * ever in the DOM, so a 10,000+ item list stays as cheap to render/scroll as a
 * few dozen. `container` must be a bounded, `overflow-y: auto` element - its own
 * scrollbar drives the windowing, not the page's.
 *
 * Row height is measured from a real rendered item rather than a hardcoded
 * guess, so it stays correct if the card's CSS (font-size, line-height, badges)
 * changes later. `gapPx` is the vertical gap between rows - pass the same value
 * as the CSS `gap` the list would otherwise use, since this renderer positions
 * rows with `transform` instead of flexbox and has to reproduce that spacing.
 */
export function renderVirtualList<T>(
  container: HTMLElement,
  items: readonly T[],
  renderItem: (item: T) => HTMLElement,
  gapPx: number,
): VirtualListHandle {
  container.innerHTML = "";
  if (items.length === 0) return { destroy(): void {} };

  const probe = renderItem(items[0]!);
  probe.style.visibility = "hidden";
  container.append(probe);
  const itemHeight = probe.getBoundingClientRect().height + gapPx;
  probe.remove();

  const spacer = document.createElement("div");
  spacer.style.position = "relative";
  spacer.style.height = `${items.length * itemHeight - gapPx}px`;
  // container is a flex column (.search-results); flex items default to
  // flex-shrink: 1, which silently squashes this spacer down to the
  // container's own height instead of letting it overflow for scrolling.
  spacer.style.flexShrink = "0";

  const content = document.createElement("div");
  content.style.position = "absolute";
  content.style.left = "0";
  content.style.right = "0";
  content.style.top = "0";
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = `${gapPx}px`;
  spacer.append(content);
  container.append(spacer);

  let renderedStart = -1;
  let renderedEnd = -1;

  function update(): void {
    const [start, end] = computeVisibleRange(
      container.scrollTop,
      container.clientHeight,
      itemHeight,
      items.length,
      OVERSCAN,
    );
    if (start === renderedStart && end === renderedEnd) return;
    renderedStart = start;
    renderedEnd = end;
    content.style.transform = `translateY(${start * itemHeight}px)`;
    content.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) fragment.append(renderItem(items[i]!));
    content.append(fragment);
  }

  let ticking = false;
  const onScroll = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  };
  container.addEventListener("scroll", onScroll);
  update();

  return {
    destroy(): void {
      container.removeEventListener("scroll", onScroll);
    },
  };
}
