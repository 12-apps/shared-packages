/**
 * The keyword box has to COMMIT what the operator typed (12-69).
 *
 * Both cases below are the search silently doing nothing: the term sits in the
 * box, the list behind it is unfiltered, and pressing Enter again changes
 * nothing. Measured in `future-pay` as a dead `?q=` on the Estoque grid — a
 * 15-second retry loop pressed Enter over and over and the URL never moved.
 */
import { fireEvent, render, screen } from "./test-utils";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { InlineKeyword } from "../data-views-search";

describe("the keyword box commits what was typed", () => {
  it("debounces to a commit even while its parent re-renders", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      // The real caller (`data-views-grid-parts.tsx`) passes a fresh arrow on
      // every render, and a busy admin page re-renders many times a second as
      // its queries land. If the debounce effect is keyed on that identity it
      // is cleared and re-armed forever and the commit NEVER happens.
      function Host(): React.JSX.Element {
        const [tick, setTick] = useState(0);
        return (
          <>
            <button type="button" data-testid="rerender" onClick={() => setTick((n) => n + 1)}>
              {tick}
            </button>
            <InlineKeyword value="" onChange={(next) => onChange(next)} testId="kw" />
          </>
        );
      }
      render(<Host />);

      fireEvent.change(screen.getByTestId("kw"), { target: { value: "Castanha" } });

      // Re-render every 100ms across the 350ms window — the page is busy, but
      // the operator has stopped typing, so the term is due to be committed.
      for (let i = 0; i < 5; i += 1) {
        fireEvent.click(screen.getByTestId("rerender"));
        vi.advanceTimersByTime(100);
      }

      expect(onChange).toHaveBeenCalledWith("Castanha");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits on Enter even when the keystroke beats React's re-render", () => {
    const onChange = vi.fn();
    render(<InlineKeyword value="" onChange={onChange} testId="kw" />);
    const box = screen.getByTestId("kw") as HTMLInputElement;

    // What Playwright's `fill` + `press('Enter')` does, and what a fast typist
    // does: the box already HOLDS the term while React has not yet processed
    // the change. Reading the component's own `draft` here sees the state
    // before the edit, decides nothing changed, and drops the keystroke.
    box.value = "Castanha";
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("Castanha");
  });
  it("still commits the clear when Escape empties a filled box", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<InlineKeyword value="Castanha" onChange={onChange} testId="kw" />);

      fireEvent.keyDown(screen.getByTestId("kw"), { key: "Escape" });
      vi.advanceTimersByTime(400);

      // Escape clears the DRAFT and the empty search is committed by the
      // debounce — the only commit path it has. Pinned because the debounce is
      // what this fix rewired.
      expect(onChange).toHaveBeenCalledWith("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not commit a second time once the host echoes the term back", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      // A real host lifts the committed term into `value`. Enter commits once
      // synchronously; the debounce must NOT then fire the same term again.
      function Host(): React.JSX.Element {
        const [value, setValue] = useState("");
        return (
          <InlineKeyword
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            testId="kw"
          />
        );
      }
      render(<Host />);
      const box = screen.getByTestId("kw") as HTMLInputElement;

      fireEvent.change(box, { target: { value: "Castanha" } });
      fireEvent.keyDown(box, { key: "Enter" });
      vi.advanceTimersByTime(400);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Castanha");
    } finally {
      vi.useRealTimers();
    }
  });
});
