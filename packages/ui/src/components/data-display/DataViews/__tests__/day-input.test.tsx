/**
 * The masked `dd/mm/aaaa` day bound that replaced `<input type="date">`.
 *
 * The native control is three segments wearing one box, so a date cannot be
 * entered as one run of digits. Driving both in Chromium with the same eight
 * keystrokes (`01072026`): the native field ends EMPTY with no filter applied,
 * the masked one reads `01/07/2026` and applies it in a single request.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayBoundInput, isoToMasked, maskDate, maskedToIso } from "../data-views-day-input";

/**
 * The two masks in the estate's own packs. Every helper case below runs against
 * BOTH, because the defect they exist to pin was one order working and the
 * other silently committing nothing (`en-US` asked for `mm/dd/yyyy` and parsed
 * `dd/mm/yyyy`, so a reader who typed what the field asked for got no filter).
 */
const BR = "dd/mm/aaaa";
const US = "mm/dd/yyyy";

/** Type `text` one character at a time, the way a keyboard delivers it. */
function typeSequentially(element: HTMLInputElement, text: string): void {
  for (const character of text) {
    fireEvent.change(element, { target: { value: element.value + character } });
  }
}

function renderInput(value?: string) {
  const onChange = vi.fn();
  render(<DayBoundInput mask="dd/mm/aaaa" label="De" value={value} onChange={onChange} testId="day" />);
  return { onChange, input: screen.getByTestId("day") as HTMLInputElement };
}

describe("maskDate", () => {
  it("inserts the separators as the digits arrive, in the mask's own order", () => {
    expect(maskDate("0", BR)).toBe("0");
    expect(maskDate("06", BR)).toBe("06");
    expect(maskDate("060", BR)).toBe("06/0");
    expect(maskDate("0608", BR)).toBe("06/08");
    expect(maskDate("06082", BR)).toBe("06/08/2");
    expect(maskDate("06082026", BR)).toBe("06/08/2026");
    // Same digits, month-first mask: the grouping is identical here because
    // both orders are 2-2-4 — what differs is what the parser then MEANS by
    // them, which `maskedToIso` below pins.
    expect(maskDate("06082026", US)).toBe("06/08/2026");
  });

  it("keeps a year-first mask's own widths", () => {
    // `yyyy-mm-dd` is a real locale order, and its first segment is four
    // digits — a 2-2-4 grouping would put the separator in the wrong place
    // from the third keystroke.
    expect(maskDate("2026", "yyyy-mm-dd")).toBe("2026");
    expect(maskDate("202608", "yyyy-mm-dd")).toBe("2026-08");
    expect(maskDate("20260806", "yyyy-mm-dd")).toBe("2026-08-06");
  });

  it("strips whatever is not a digit, so a paste still lands", () => {
    expect(maskDate("06/08/2026", BR)).toBe("06/08/2026");
    expect(maskDate("2026-08-06", BR)).toBe("20/26/0806");
  });

  it("caps at the eight digits a day has", () => {
    expect(maskDate("0608202699", BR)).toBe("06/08/2026");
  });

  it("falls back to day-first for a mask it cannot read", () => {
    // This runs on every keystroke; a field that renders is recoverable where
    // one that throws takes the grid down with it. Only the ORDER falls back —
    // the separator is still the one the placeholder showed, so the field never
    // renders a shape its own hint did not promise.
    expect(maskDate("06082026", "?")).toBe("06?08?2026");
    expect(maskDate("06082026", "dd/dd/yyyy")).toBe("06/08/2026");
  });
});

describe("maskedToIso", () => {
  it("reads each mask in ITS OWN order", () => {
    // The whole defect, in two lines: the same eight digits are two different
    // days depending on what the field asked for.
    expect(maskedToIso("06/08/2026", BR)).toBe("2026-08-06");
    expect(maskedToIso("06/08/2026", US)).toBe("2026-06-08");
    expect(maskedToIso("2026-08-06", "yyyy-mm-dd")).toBe("2026-08-06");
  });

  it("refuses a day that does not exist, in either order", () => {
    expect(maskedToIso("31/02/2026", BR)).toBe("");
    expect(maskedToIso("32/01/2026", BR)).toBe("");
    expect(maskedToIso("01/13/2026", BR)).toBe("");
    // `31/12` is a real day day-first and an impossible one month-first — the
    // asymmetry IS the point, and typing it into an en-US field must commit
    // nothing rather than roll into the next year.
    expect(maskedToIso("31/12/2099", BR)).toBe("2099-12-31");
    expect(maskedToIso("31/12/2099", US)).toBe("");
  });

  it("refuses anything that is not eight digits", () => {
    expect(maskedToIso("", BR)).toBe("");
    expect(maskedToIso("06/08", BR)).toBe("");
    expect(maskedToIso("06/08/202", BR)).toBe("");
  });
});

describe("isoToMasked", () => {
  it("writes the wire day in the mask's order", () => {
    expect(isoToMasked("2026-08-06", BR)).toBe("06/08/2026");
    expect(isoToMasked("2026-08-06", US)).toBe("08/06/2026");
    expect(isoToMasked("2026-08-06", "yyyy-mm-dd")).toBe("2026-08-06");
  });

  it("answers empty for anything that is not a wire day", () => {
    expect(isoToMasked("", BR)).toBe("");
    expect(isoToMasked("06/08/2026", BR)).toBe("");
  });

  it("round-trips through the mask it was written with", () => {
    for (const mask of [BR, US, "yyyy-mm-dd"]) {
      expect(maskedToIso(isoToMasked("2026-08-06", mask), mask)).toBe("2026-08-06");
    }
  });
});

describe("DayBoundInput", () => {
  it("accepts the whole date as one continuous run of digits", async () => {
    const { input } = renderInput();
    typeSequentially(input, "06082026");
    await waitFor(() => expect(input).toHaveValue("06/08/2026"));
  });

  it("writes the bound ONCE, when the date is complete", async () => {
    const { onChange, input } = renderInput();
    typeSequentially(input, "06082026");
    // The seven partial states before it — including `0002`, `0020` and `0202`,
    // each a real day — must not have reached the grid. Committing on every
    // keystroke would make one date cost four fetches, three for years nobody
    // typed on purpose.
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith("2026-08-06");
  });

  it("leaves the applied bound alone while a date is half-typed", () => {
    const { onChange, input } = renderInput("2026-08-06");
    fireEvent.change(input, { target: { value: "06/08/20" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue("06/08/20");
  });

  it("clears the bound when the field is emptied", () => {
    const { onChange, input } = renderInput("2026-08-06");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("does not write an impossible day", async () => {
    const { onChange, input } = renderInput();
    typeSequentially(input, "31022026");
    await waitFor(() => expect(input).toHaveValue("31/02/2026"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks for the digit keypad on the INPUT, where the attribute decides anything", () => {
    // Passed as a `TextField` prop this rode the `...rest` spread onto the root
    // `FormControl` div — an element that is not editable, so the attribute did
    // nothing and the phone kept opening the letter keyboard over a field that
    // only accepts digits. Asserting on the input, not on the tree, is the
    // point: a wrapper carrying `inputmode` is exactly the bug.
    const { input } = renderInput();
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input.tagName).toBe("INPUT");
  });

  it("keeps autofill off, so its strip cannot cover the keypad with non-dates", () => {
    const { input } = renderInput();
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it("drops letters, so a hardware keyboard cannot type into it either", () => {
    // The keypad narrows what a thumb can reach; the mask is what makes the
    // field digits-only for every other way text arrives.
    const { onChange, input } = renderInput();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "0a6b0c8" } });
    expect(input).toHaveValue("06/08");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("a"));
  });

  it("shows the applied bound in the merchant's format, not the wire's", () => {
    const { input } = renderInput("2026-08-06");
    expect(input).toHaveValue("06/08/2026");
  });

  it("snaps back to the applied bound on blur, so a half-typed date never lingers", () => {
    const { input } = renderInput("2026-08-06");
    fireEvent.change(input, { target: { value: "31/02/20" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("06/08/2026");
  });

  it("re-syncs when the bound is cleared from outside (a Limpar, a saved view)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DayBoundInput mask="dd/mm/aaaa" label="De" value="2026-08-06" onChange={onChange} testId="day" />,
    );
    expect(screen.getByTestId("day")).toHaveValue("06/08/2026");
    rerender(<DayBoundInput mask="dd/mm/aaaa" label="De" value={undefined} onChange={onChange} testId="day" />);
    expect(screen.getByTestId("day")).toHaveValue("");
  });

  it("does NOT reset the caret by echoing the field's own write back at it", async () => {
    // The applied bound arriving back as this controlled input's value is what
    // made the native field wipe itself mid-edit. Typing a complete date and
    // receiving it back must leave the text exactly as typed.
    const onChange = vi.fn();
    const { rerender } = render(
      <DayBoundInput mask="dd/mm/aaaa" label="De" value={undefined} onChange={onChange} testId="day" />,
    );
    const input = screen.getByTestId("day") as HTMLInputElement;
    typeSequentially(input, "06082026");
    rerender(<DayBoundInput mask="dd/mm/aaaa" label="De" value="2026-08-06" onChange={onChange} testId="day" />);
    await waitFor(() => expect(screen.getByTestId("day")).toHaveValue("06/08/2026"));
  });
});
