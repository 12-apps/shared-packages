/**
 * FUT-3831: the three things the Turnos review found on the ruler — a short
 * bar's hit band, the column reserved for one row's actions, and a short
 * label cut inside a short bar.
 */
import { createTheme, decomposeColor } from "@mui/material/styles/index.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayRuler } from "../DayRuler";
import { DAY_RULER_LABELS } from "../DayRuler.labels";
import { hitBoundsOf, textFitOf } from "../day-ruler-model";
import type { DayRulerProps } from "../DayRuler.types";
import { dashedLabelGround } from "../../ScheduleGrid/schedule-tones";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRuler(overrides: Partial<DayRulerProps> = {}): void {
  render(
    <DayRuler
      rows={[
        {
          id: "alice",
          label: "Alice Tanaka",
          meta: "atrasado · era 05:30",
          blocks: [{ id: "a1", start: 6, end: 13, label: "06:00–13:00", tone: "late" }],
          actions: <button type="button">Iniciar agora</button>,
        },
        { id: "bruno", label: "Bruno Esteves", blocks: [] },
      ]}
      labels={DAY_RULER_LABELS["pt-BR"]}
      dataTestId="dr"
      {...overrides}
    />,
  );
}

describe("a bar's hit band never reaches past the midpoint to its neighbour", () => {
  it("reaches the track's ends when the bar is alone", () => {
    expect(hitBoundsOf([{ at: 30, share: 5 }])).toEqual([{ lo: 0, hi: 100 }]);
  });

  it("splits the gap between two bars at its midpoint, whatever order they come in", () => {
    // 40–45 and 49–60: the gap 45…49 is split at 47.
    expect(hitBoundsOf([{ at: 49, share: 11 }, { at: 40, share: 5 }])).toEqual([
      { lo: 47, hi: 100 },
      { lo: 0, hi: 47 },
    ]);
  });

  it("gives a touching or overlapping neighbour nothing past the bar's own edge", () => {
    expect(hitBoundsOf([{ at: 10, share: 10 }, { at: 20, share: 5 }])).toEqual([
      { lo: 0, hi: 20 },
      { lo: 20, hi: 100 },
    ]);
    expect(hitBoundsOf([{ at: 10, share: 10 }, { at: 15, share: 10 }])).toEqual([
      { lo: 0, hi: 20 },
      { lo: 15, hi: 100 },
    ]);
  });

  it("bounds a middle bar on both sides", () => {
    const [, middle] = hitBoundsOf([
      { at: 0, share: 10 },
      { at: 20, share: 2 },
      { at: 30, share: 10 },
    ]);
    expect(middle).toEqual({ lo: 15, hi: 26 });
  });
});

describe("a block's text fits or is not drawn", () => {
  it("says the full text, else the short one, else nothing", () => {
    expect(textFitOf(70, 30, 120)).toBe("full");
    expect(textFitOf(70, 30, 40)).toBe("short");
    // The 33px bar of the review: 21px of room, "12:00" needs 30.
    expect(textFitOf(70, 30, 21)).toBe("none");
  });

  it("an empty bar still names its whole text and keeps its tooltip", () => {
    class Observer {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(33);
    // "12:00–13:00" is 70px and "12:00" 40px: neither fits a 33px bar (jsdom
    // reads the padding as its rem number, so the room here is ~32px).
    // jsdom draws nothing, so a Range has no box of its own to spy on until one is given.
    if (!("getBoundingClientRect" in Range.prototype)) {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => ({}) as DOMRect, configurable: true, writable: true });
    }
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Range) {
      return { width: this.startContainer.textContent === "12:00" ? 40 : 70 } as DOMRect;
    });
    renderRuler({
      rows: [
        {
          id: "c",
          label: "Caio",
          blocks: [{ id: "s", start: 12, end: 13, label: "12:00–13:00", shortLabel: "12:00", tone: "plan" }],
        },
      ],
    });
    const bar = screen.getByTestId("dr-block-s");
    expect(bar).toHaveAttribute("data-fit", "none");
    expect(screen.getByRole("button", { name: "12:00–13:00" })).toBe(bar);
    expect(bar).toHaveAttribute("title", "12:00–13:00");
  });
});

describe("a row's actions take no column of their own", () => {
  it("draws an actions slot only on the row that has actions", () => {
    renderRuler();
    expect(screen.getByTestId("dr-actions-alice")).toContainElement(screen.getByRole("button", { name: "Iniciar agora" }));
    // Name and track only: no empty slot is left to hold a column open.
    expect(screen.getByTestId("dr-row-alice").children).toHaveLength(3);
    expect(screen.getByTestId("dr-row-bruno").children).toHaveLength(2);
  });
});

describe("the now line never cuts a label", () => {
  it("is drawn before the blocks, so it paints under them", () => {
    renderRuler({ now: 10 });
    const track = screen.getByTestId("dr-track-alice");
    const kids = Array.from(track.children).map((el) => el.getAttribute("data-testid"));
    expect(kids.indexOf("dr-now")).toBeLessThan(kids.indexOf("dr-block-a1"));
  });

  it("gives a label an opaque ground only where the block's fill is not opaque", () => {
    const theme = createTheme();
    for (const tone of ["plan", "away", "uncovered"] as const) {
      expect(decomposeColor(dashedLabelGround(theme, tone)!).values[3] ?? 1).toBe(1);
    }
    expect(dashedLabelGround(theme, "late")).toBeUndefined();
    expect(dashedLabelGround(theme, "onduty")).toBeUndefined();
  });
});
