/**
 * THE STICKY TOOLBAR'S TWO HOOKS (FUT-3330, review round 1).
 *
 * `useStickyBarTop` lifts the bar by the scroll container's own top padding,
 * and gives it back on unmount. `paint` moves the header cells by a measured
 * offset and puts them back at 0. `useStickyTableHead` leaves no listener or
 * observer behind, and no translated header, when it is switched off.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STICKY_BAR_ATTR, paint, useStickyBarTop, useStickyTableHead } from "../data-views-sticky-head";


/** A scroll pane padded 24px holding the shell, its sticky bar and a one-row table. */
function buildPage(): { pane: HTMLDivElement; shell: HTMLDivElement; bar: HTMLDivElement; wrapper: HTMLDivElement } {
  const pane = document.createElement("div");
  pane.style.overflowY = "auto";
  pane.style.paddingTop = "24px";
  const shell = document.createElement("div");
  const bar = document.createElement("div");
  bar.setAttribute(STICKY_BAR_ATTR, "");
  const wrapper = document.createElement("div");
  wrapper.innerHTML = "<table><thead><tr><th>Produto</th><th>Preço</th></tr></thead><tbody></tbody></table>";
  shell.append(bar, wrapper);
  pane.append(shell);
  document.body.append(pane);
  return { pane, shell, bar, wrapper };
}

let page: ReturnType<typeof buildPage>;

beforeEach(() => {
  page = buildPage();
});

afterEach(() => {
  page.pane.remove();
  vi.unstubAllGlobals();
});

/** A DOMMatrix stand-in: jsdom has none, and `paint` only reads its string. */
function stubMatrix(): void {
  class FakeMatrix {
    constructor(private readonly y = 0) {}
    translate(_x: number, y: number): FakeMatrix {
      return new FakeMatrix(y);
    }
    toString(): string {
      return `matrix(1, 0, 0, 1, 0, ${this.y})`;
    }
  }
  vi.stubGlobal("DOMMatrixReadOnly", FakeMatrix);
}

describe("useStickyBarTop", () => {
  it("lifts the bar by its scroll pane's top padding, and gives it back on unmount", () => {
    const { shell, bar } = page;
    const { unmount } = renderHook(() => useStickyBarTop({ current: shell }, true));
    // jsdom normalises the calc; the padding is what matters.
    expect(bar.style.top).toMatch(/^calc\(-(1 \* )?24px\)$/);
    unmount();
    expect(bar.style.top).toBe("");
  });

  it("does nothing while the toolbar is not sticky", () => {
    const { shell, bar } = page;
    renderHook(() => useStickyBarTop({ current: shell }, false));
    expect(bar.style.top).toBe("");
  });
});

describe("paint", () => {
  it("moves every header cell by the offset, above the rows, and puts them back at 0", () => {
    stubMatrix();
    const head = page.wrapper.querySelector("thead") as HTMLElement;
    paint(head, 120);
    const cells = [...head.querySelectorAll<HTMLElement>("th")];
    expect(cells.map((cell) => cell.style.transform)).toEqual(["matrix(1, 0, 0, 1, 0, 120)", "matrix(1, 0, 0, 1, 0, 120)"]);
    expect(cells.every((cell) => cell.style.zIndex === "2")).toBe(true);
    paint(head, 0);
    expect(cells.every((cell) => cell.style.transform === "" && cell.style.zIndex === "")).toBe(true);
  });

  it("leaves the header in its table where DOMMatrix does not exist", () => {
    vi.stubGlobal("DOMMatrixReadOnly", undefined);
    const head = page.wrapper.querySelector("thead") as HTMLElement;
    paint(head, 120);
    expect(head.querySelector("th")?.style.transform).toBe("");
  });
});

describe("useStickyTableHead", () => {
  it("listens to the page's scroll while on, and leaves nothing behind when switched off", () => {
    stubMatrix();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useStickyTableHead({ current: page.wrapper }, true));
    expect(add.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["scroll", "resize"]));

    paint(page.wrapper.querySelector("thead") as HTMLElement, 80);
    unmount();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["scroll", "resize"]));
    expect(page.wrapper.querySelector("th")?.style.transform).toBe("");
  });
});
