// @vitest-environment jsdom
/**
 * The flow's frame (FUT-3525): measured once at the host's full width, so
 * every step agrees on whether this is the computer's layout or the phone's.
 * Kept from the tabbed checkout's layout suite when the tabs went (FUT-4028);
 * the list's own relayout cases are `payment-list-relayout.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type JSX } from "react";

import { useWideLayout, WIDE_CHECKOUT_MIN } from "../payment-step-layout";
import { cleanup, fireEvent, render, screen } from "./test-utils";

afterEach(cleanup);

describe("the frame", () => {
  function Probe(): JSX.Element {
    const [wide, ref] = useWideLayout();
    return <div ref={ref} data-testid="probe" data-wide={String(wide)} />;
  }

  it(`is wide from ${WIDE_CHECKOUT_MIN}px of the container, narrow under it`, () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockReturnValue({ width: WIDE_CHECKOUT_MIN } as DOMRect);
    render(<Probe />);
    expect(screen.getByTestId("probe").getAttribute("data-wide")).toBe("true");
    cleanup();

    spy.mockReturnValue({ width: WIDE_CHECKOUT_MIN - 1 } as DOMRect);
    render(<Probe />);
    expect(screen.getByTestId("probe").getAttribute("data-wide")).toBe("false");
    spy.mockRestore();
  });

  it("measures a frame that mounts AFTER the first render (the cart loads late)", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockReturnValue({ width: 1200 } as DOMRect);
    function Late(): JSX.Element {
      const [ready, setReady] = useState(false);
      const [wide, ref] = useWideLayout();
      return ready ? (
        <div ref={ref} data-testid="late" data-wide={String(wide)} />
      ) : (
        <button type="button" onClick={() => setReady(true)}>
          load
        </button>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByText("load"));
    expect(screen.getByTestId("late").getAttribute("data-wide")).toBe("true");
    spy.mockRestore();
  });
});
