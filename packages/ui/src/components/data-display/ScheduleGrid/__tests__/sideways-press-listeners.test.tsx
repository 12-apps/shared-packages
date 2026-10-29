/**
 * The grid hears a press end on the window (a press can lift outside the days):
 * those listeners are the grid's for its lifetime, never one more per click,
 * and none outlives it (FUT-3825, code re-check of 157987c7).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleGrid } from "../ScheduleGrid";
import type { ScheduleGridCell } from "../ScheduleGrid.types";

const COLUMNS = ["Seg 19/10", "Ter 20/10", "Qua 21/10"].map((label) => ({ label }));
const cell = (): ScheduleGridCell => ({ blocks: [] });

type Listener = EventListenerOrEventListenerObject;

/**
 * The window's live pointer listeners, counted the way the browser keeps them:
 * one per (type, listener, capture), and a `once` listener gone after it runs
 * (jsdom drops it without calling removeEventListener, so it is wrapped here).
 */
function trackWindowPointerListeners(): () => number {
  const live = new Map<string, Listener>();
  const wrappers = new Map<Listener, Map<string, Listener>>();
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  const keyOf = (type: string, capture: boolean): string => `${type}:${capture ? "capture" : "bubble"}`;
  const captureOf = (options?: boolean | EventListenerOptions): boolean =>
    typeof options === "boolean" ? options : Boolean(options?.capture);
  const idOf = new Map<Listener, number>();
  const fullKey = (type: string, listener: Listener, capture: boolean): string => {
    if (!idOf.has(listener)) idOf.set(listener, idOf.size + 1);
    return `${keyOf(type, capture)}:${idOf.get(listener)}`;
  };
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: Listener | null, options?: boolean | AddEventListenerOptions) => {
    if (!listener) return undefined;
    if (!type.startsWith("pointer")) return add(type, listener, options);
    const capture = captureOf(options);
    const key = fullKey(type, listener, capture);
    if (live.has(key)) return undefined;
    const once = typeof options === "object" && Boolean(options.once);
    const wrapped: Listener = (event: Event) => {
      if (once) live.delete(key);
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    };
    live.set(key, wrapped);
    const byKey = wrappers.get(listener) ?? new Map<string, Listener>();
    byKey.set(keyOf(type, capture), wrapped);
    wrappers.set(listener, byKey);
    return add(type, wrapped, options);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type: string, listener: Listener | null, options?: boolean | EventListenerOptions) => {
    if (!listener) return undefined;
    if (!type.startsWith("pointer")) return remove(type, listener, options);
    const capture = captureOf(options);
    const wrapped = wrappers.get(listener)?.get(keyOf(type, capture));
    live.delete(fullKey(type, listener, capture));
    return remove(type, wrapped ?? listener, options);
  });
  return () => live.size;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the press's window listeners", () => {
  it("stay the same number however many clicks land, and are gone once the grid unmounts", () => {
    const count = trackWindowPointerListeners();
    // A host re-renders the grid after a click (its log, a selection): each render is a new grid render.
    const grid = (clicks: number) => (
      <ScheduleGrid columns={COLUMNS} groups={[{ rows: [{ id: "ana", label: `Ana Lima ${clicks}` }] }]} cell={cell} onBlockClick={vi.fn()} dataTestId="sg" />
    );
    const { rerender, unmount } = render(grid(0));
    const scroller = screen.getByTestId("sg-scroll");
    const press = (click: number): void => {
      rerender(grid(click));
      fireEvent.pointerDown(scroller, { pointerType: "mouse", button: 0, isPrimary: true });
      fireEvent.pointerUp(scroller, { pointerType: "mouse", button: 0, isPrimary: true });
      fireEvent.click(scroller);
    };
    press(1);
    const afterOne = count();
    for (let click = 2; click <= 26; click += 1) press(click);
    expect(count()).toBe(afterOne);
    unmount();
    expect(count()).toBe(0);
  });
});
