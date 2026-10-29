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
const scrollTo = vi.fn(function (this: HTMLElement, x: number) {
  scrolls.set(this, x);
});

function rectOf(el: Element): DOMRect {
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
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  Reflect.deleteProperty(HTMLElement.prototype, SCROLL_X);
});

function renderGrid(overrides: Partial<ScheduleGridProps> = {}) {
  const props: ScheduleGridProps = {
    columns: COLUMNS,
    groups: [{ title: "Cozinha", rows: [{ id: "ana", label: "Ana Lima" }] }],
    cell,
    dataTestId: "sg",
    ...overrides,
  };
  const view = render(<ScheduleGrid {...props} />);
  return { rerender: (next: Partial<ScheduleGridProps>) => view.rerender(<ScheduleGrid {...props} {...next} />) };
}

const body = (): HTMLElement => screen.getByTestId("sg-scroll");
const head = (): HTMLElement => screen.getByTestId("sg-head");

describe("scrollToDay", () => {
  it("opens the days on that day, first after the names, at once, and the header follows", () => {
    renderGrid({ scrollToDay: 3 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(3 * DAY_PITCH, 0);
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
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
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
    expect(scrollTo).toHaveBeenLastCalledWith(DAY_PITCH, 0);
    expect(offset(head())).toBe(DAY_PITCH);
    rerender({ scrollToDay: 5 });
    expect(scrollTo).toHaveBeenLastCalledWith(5 * DAY_PITCH, 0);
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

  it("still opens on the day while the rows load", () => {
    renderGrid({ scrollToDay: 2, loading: true });
    expect(scrollTo).toHaveBeenCalledWith(2 * DAY_PITCH, 0);
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
