/**
 * `scrollToDay` and the pinned group title (FUT-3831, the Turnos review): a
 * week opened mid-week shows today first after the names, and a group's title
 * stays readable however far the days scroll. jsdom has no layout, so the
 * header's boxes and the scroll offsets are stood in for here; the browser
 * stories (`ScheduleGrid.test.stories.tsx`) prove the same on real boxes.
 */
import { createTheme } from "@mui/material/styles/index.js";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CSSObject } from "@emotion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleGrid } from "../ScheduleGrid";
import { frameSx } from "../ScheduleGrid.styles";
import type { ScheduleGridCell, ScheduleGridProps } from "../ScheduleGrid.types";

const COLUMNS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label) => ({ label }));
const cell = (): ScheduleGridCell => ({ blocks: [] });

/** The stood-in geometry: names end at 140, a 6px gap, then 158px per day (152 + the gap). */
const NAMES_RIGHT = 140;
const GAP = 6;
const DAY_PITCH = 158;

const scrolls = new WeakMap<Element, number>();
/** The stood-in sideways offset of `el` (what the grid reads and writes as its scroll). */
const offset = (el: Element): number => scrolls.get(el) ?? 0;
/** The property the stand-in replaces; named once so no assertion reads the real one. */
const SCROLL_X = "scroll" + "Left";
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
  scrolls.set(this, options.left ?? 0);
});


/** The ResizeObservers the grid made, so a test can deliver the first width. */
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /** The browser reporting a size change. */
  deliver(): void {
    if (!this.disconnected) this.callback([], this as unknown as ResizeObserver);
  }
}

function rectOf(el: Element): DOMRect {
  // Inside a `hidden` host: no box, as under `display: none` or in a container with no width yet.
  if (el.closest("[hidden]")) return new DOMRect(0, 0, 0, 0);
  const head = el.closest("[data-sg-head]");
  const shift = head ? (scrolls.get(head) ?? 0) : 0;
  if (el.hasAttribute("data-sg-corner")) return new DOMRect(0, 0, NAMES_RIGHT, 40);
  if (el.getAttribute("role") === "columnheader" && head) {
    const day = Array.from(head.querySelectorAll('[role="columnheader"]')).indexOf(el);
    return new DOMRect(NAMES_RIGHT + GAP + day * DAY_PITCH - shift, 0, DAY_PITCH - GAP, 40);
  }
  return new DOMRect(0, 0, 0, 0);
}

beforeEach(() => {
  scrollTo.mockClear();
  FakeResizeObserver.made = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectOf(this);
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true, writable: true });
  Object.defineProperty(HTMLElement.prototype, SCROLL_X, {
    configurable: true,
    get(this: HTMLElement) {
      return scrolls.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrolls.set(this, value);
    },
  });
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const style = realStyle(el, pseudo);
    if (el.getAttribute("role") !== "row") return style;
    return new Proxy(style, { get: (target, key) => (key === "columnGap" ? `${GAP}px` : Reflect.get(target, key)) });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  Reflect.deleteProperty(HTMLElement.prototype, SCROLL_X);
});

/** A host element with no box yet; `show()` gives it one. */
function hiddenHost(): { container: HTMLElement; show: () => void } {
  const container = document.createElement("div");
  container.hidden = true;
  document.body.append(container);
  return { container, show: () => container.removeAttribute("hidden") };
}

function renderGrid(overrides: Partial<ScheduleGridProps> = {}, container?: HTMLElement) {
  const props: ScheduleGridProps = {
    columns: COLUMNS,
    groups: [{ title: "Cozinha", rows: [{ id: "ana", label: "Ana Lima" }] }],
    cell,
    dataTestId: "sg",
    ...overrides,
  };
  const view = render(<ScheduleGrid {...props} />, container ? { container } : undefined);
  return { rerender: (next: Partial<ScheduleGridProps>) => view.rerender(<ScheduleGrid {...props} {...next} />) };
}

const body = (): HTMLElement => screen.getByTestId("sg-scroll");
const head = (): HTMLElement => screen.getByTestId("sg-head");

describe("scrollToDay", () => {
  it("opens the days on that day, first after the names, at once, and the header follows", () => {
    renderGrid({ scrollToDay: 3 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 3 * DAY_PITCH, behavior: "instant" });
    expect(scrollTo.mock.contexts[0]).toBe(body());
    expect(offset(body())).toBe(3 * DAY_PITCH);
    expect(offset(head())).toBe(3 * DAY_PITCH);
    // The jump is instant: the scroller's own scroll-behavior is pinned, whatever the page sets.
    expect(getComputedStyle(body()).getPropertyValue("scroll-behavior")).toBe("auto");
  });

  it("does nothing without a value, and day 0 is the start", () => {
    const { rerender } = renderGrid();
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ scrollToDay: 0 });
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: "instant" });
  });

  it("keeps the person's own scroll on a re-render with the same day", () => {
    const { rerender } = renderGrid({ scrollToDay: 3 });
    Reflect.set(body(), SCROLL_X, 40); // the person's own sideways scroll
    rerender({ scrollToDay: 3, totalLabel: "horas" });
    rerender({ scrollToDay: 3, groups: [{ title: "Cozinha", rows: [{ id: "ana", label: "Ana" }] }] });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(offset(body())).toBe(40);
  });

  it("scrolls again each time the day changes, from wherever the days are", () => {
    const { rerender } = renderGrid({ scrollToDay: 3 });
    rerender({ scrollToDay: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: DAY_PITCH, behavior: "instant" });
    expect(offset(head())).toBe(DAY_PITCH);
    rerender({ scrollToDay: 5 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 5 * DAY_PITCH, behavior: "instant" });
  });

  it("ignores a day that is not a column", () => {
    const { rerender } = renderGrid({ scrollToDay: 7 });
    rerender({ scrollToDay: -1 });
    rerender({ scrollToDay: 1.5 });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves focus where it was and never scrolls the page", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    // Through the prototype inside `act`: the flakiness lint flags `.focus()` (as SectionNav's tests do).
    await act(async () => {
      HTMLElement.prototype.focus.call(outside);
    });
    await waitFor(() => expect(outside).toHaveFocus());
    const pageScroll = vi.spyOn(window, "scrollTo");
    const intoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: intoView, configurable: true, writable: true });
    const { rerender } = renderGrid({ scrollToDay: 2 });
    rerender({ scrollToDay: 4 });
    await waitFor(() => expect(outside).toHaveFocus());
    expect(pageScroll).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    outside.remove();
  });

  it("waits for the rows while they load, anchors once they are drawn, and not again on a refetch", () => {
    const { rerender } = renderGrid({ scrollToDay: 2, loading: true });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ scrollToDay: 2, loading: false });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 2 * DAY_PITCH, behavior: "instant" });
    Reflect.set(body(), SCROLL_X, 40); // the person's own sideways scroll
    rerender({ scrollToDay: 2, loading: true });
    rerender({ scrollToDay: 2, loading: false });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(offset(body())).toBe(40);
  });

  it("waits while there are no rows or an error, then anchors on the drawn days", () => {
    const { rerender } = renderGrid({ scrollToDay: 4, groups: [], empty: "Ninguém" });
    const kitchen = [{ title: "Cozinha", rows: [{ id: "ana", label: "Ana Lima" }] }];
    rerender({ scrollToDay: 4, groups: kitchen, error: "Falhou" });
    expect(scrollTo).not.toHaveBeenCalled();
    rerender({ scrollToDay: 4, groups: kitchen, error: undefined });
    expect(scrollTo).toHaveBeenCalledWith({ left: 4 * DAY_PITCH, behavior: "instant" });
  });

  it("with no box yet (hidden, or a container sized after mount) waits for the first width, once", () => {
    const host = hiddenHost();
    renderGrid({ scrollToDay: 3 }, host.container);
    expect(scrollTo).not.toHaveBeenCalled();
    const [observer] = FakeResizeObserver.made;
    if (!observer) throw new Error("no ResizeObserver");
    expect(observer.observed).toEqual([head()]);
    observer.deliver(); // a resize that still has no width
    expect(scrollTo).not.toHaveBeenCalled();
    expect(observer.disconnected).toBe(false);
    host.show();
    act(() => observer.deliver());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ left: 3 * DAY_PITCH, behavior: "instant" });
    expect(offset(head())).toBe(3 * DAY_PITCH);
    expect(observer.disconnected).toBe(true);
  });

  it("stops waiting for a width when the day changes or the grid goes away", () => {
    const { rerender } = renderGrid({ scrollToDay: 3 }, hiddenHost().container);
    const [first] = FakeResizeObserver.made;
    rerender({ scrollToDay: 5 });
    expect(first?.disconnected).toBe(true);
    cleanup();
    expect(FakeResizeObserver.made[1]?.disconnected).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("measures from the header's own scroll, not a body the header has not caught up with yet", () => {
    const { rerender } = renderGrid({ scrollToDay: 1 });
    expect(offset(head())).toBe(DAY_PITCH);
    // The person scrolled the days; the scroll event that syncs the header has not run yet.
    Reflect.set(body(), SCROLL_X, 50);
    rerender({ scrollToDay: 3 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 3 * DAY_PITCH, behavior: "instant" });
  });
});

describe("the group title while the days scroll", () => {
  it("makes each group as wide as its rows, so its pinned title never runs out of room", () => {
    const styles = (frameSx(7, true) as (theme: ReturnType<typeof createTheme>) => CSSObject)(createTheme());
    const scrolled = Object.entries(styles).find(
      ([key, value]) => key.startsWith("@container") && typeof value === "object" && value !== null && "& [data-sg-group-title]" in value,
    )?.[1] as CSSObject | undefined;
    expect(scrolled?.["& [data-sg-group-title]"]).toMatchObject({ position: "sticky", left: 0 });
    expect(scrolled?.['& [role="rowgroup"]']).toEqual({ minWidth: "var(--sg-min)" });
  });
});
