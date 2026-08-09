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

import { DayBoundInput, brToIso, isoToBr, maskBrDate } from "../data-views-day-input";

/** Type `text` one character at a time, the way a keyboard delivers it. */
function typeSequentially(element: HTMLInputElement, text: string): void {
  for (const character of text) {
    fireEvent.change(element, { target: { value: element.value + character } });
  }
}

function renderInput(value?: string) {
  const onChange = vi.fn();
  render(<DayBoundInput label="De" value={value} onChange={onChange} testId="day" />);
  return { onChange, input: screen.getByTestId("day") as HTMLInputElement };
}

describe("maskBrDate", () => {
  it("inserts each separator as the digit that needs it arrives", () => {
    expect(maskBrDate("0")).toBe("0");
    expect(maskBrDate("06")).toBe("06");
    expect(maskBrDate("060")).toBe("06/0");
    expect(maskBrDate("0608")).toBe("06/08");
    expect(maskBrDate("06082")).toBe("06/08/2");
    expect(maskBrDate("06082026")).toBe("06/08/2026");
  });

  it("ignores everything that is not a digit, so a pasted date still lands", () => {
    expect(maskBrDate("06/08/2026")).toBe("06/08/2026");
    expect(maskBrDate("2026-08-06")).toBe("20/26/0806");
  });

  it("stops at eight digits rather than growing past a date", () => {
    expect(maskBrDate("0608202699")).toBe("06/08/2026");
  });

  it("renders four digits WITHOUT a trailing separator, so backspace never stalls", () => {
    // "06/08/" would swallow the keystroke that deleted the year's first digit:
    // the mask would put the separator straight back and nothing would move.
    expect(maskBrDate("0608")).toBe("06/08");
  });
});

describe("brToIso", () => {
  it("converts a whole day to the wire format", () => {
    expect(brToIso("06/08/2026")).toBe("2026-08-06");
  });

  it("rejects a day that does not exist instead of rolling it into next month", () => {
    expect(brToIso("31/02/2026")).toBe("");
    expect(brToIso("32/01/2026")).toBe("");
    expect(brToIso("01/13/2026")).toBe("");
  });

  it("rejects anything that is not yet a whole date", () => {
    expect(brToIso("")).toBe("");
    expect(brToIso("06")).toBe("");
    expect(brToIso("06/08")).toBe("");
    expect(brToIso("06/08/20")).toBe("");
  });

  it("round-trips with isoToBr", () => {
    expect(isoToBr(brToIso("06/08/2026"))).toBe("06/08/2026");
    expect(isoToBr("")).toBe("");
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
      <DayBoundInput label="De" value="2026-08-06" onChange={onChange} testId="day" />,
    );
    expect(screen.getByTestId("day")).toHaveValue("06/08/2026");
    rerender(<DayBoundInput label="De" value={undefined} onChange={onChange} testId="day" />);
    expect(screen.getByTestId("day")).toHaveValue("");
  });

  it("does NOT reset the caret by echoing the field's own write back at it", async () => {
    // The applied bound arriving back as this controlled input's value is what
    // made the native field wipe itself mid-edit. Typing a complete date and
    // receiving it back must leave the text exactly as typed.
    const onChange = vi.fn();
    const { rerender } = render(
      <DayBoundInput label="De" value={undefined} onChange={onChange} testId="day" />,
    );
    const input = screen.getByTestId("day") as HTMLInputElement;
    typeSequentially(input, "06082026");
    rerender(<DayBoundInput label="De" value="2026-08-06" onChange={onChange} testId="day" />);
    await waitFor(() => expect(screen.getByTestId("day")).toHaveValue("06/08/2026"));
  });
});
