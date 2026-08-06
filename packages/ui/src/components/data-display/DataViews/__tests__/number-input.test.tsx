/**
 * The pt-BR numeric bound that replaced `<input type="number">`.
 *
 * The native control parses in the browser's locale and drops silently what it
 * cannot read. Measured in Chromium on the Pedidos value filter: typing `50,00`
 * left the field reading `5000` and applied a filter of R$ 5.000 — a hundred
 * times what was asked for, with an empty list and a chip that agreed with the
 * mistake. That is what "o filtro de valor não está funcionando" was.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  NumberBoundInput,
  formatPtBrNumber,
  parsePtBrNumber,
} from "../data-views-number-input";

function renderInput(value?: number, unit?: string, step?: number) {
  const onChange = vi.fn();
  render(
    <NumberBoundInput
      label="De"
      value={value}
      unit={unit}
      step={step}
      onChange={onChange}
      testId="amount"
    />,
  );
  return { onChange, input: screen.getByTestId("amount") as HTMLInputElement };
}

describe("parsePtBrNumber", () => {
  it("reads the comma as the decimal point", () => {
    expect(parsePtBrNumber("50,00")).toBe(50);
    expect(parsePtBrNumber("17,50")).toBe(17.5);
    expect(parsePtBrNumber("0,99")).toBe(0.99);
  });

  it("reads the dot as a thousands group when a comma is present", () => {
    expect(parsePtBrNumber("1.234,56")).toBe(1234.56);
    expect(parsePtBrNumber("1.000.000,00")).toBe(1000000);
  });

  it("reads a lone dot before one or two digits as a decimal typed on a keypad", () => {
    // `50.00` is overwhelmingly a decimal somebody typed, and reading it as
    // 5000 is the exact failure this field replaces.
    expect(parsePtBrNumber("50.00")).toBe(50);
    expect(parsePtBrNumber("1.5")).toBe(1.5);
  });

  it("reads a lone dot before three digits as a thousand", () => {
    expect(parsePtBrNumber("1.234")).toBe(1234);
  });

  it("takes a plain integer unchanged", () => {
    expect(parsePtBrNumber("50")).toBe(50);
    expect(parsePtBrNumber("0")).toBe(0);
  });

  it("returns undefined for what is not a number yet", () => {
    expect(parsePtBrNumber("")).toBeUndefined();
    expect(parsePtBrNumber("abc")).toBeUndefined();
  });
});

describe("formatPtBrNumber", () => {
  it("shows the decimal with a comma", () => {
    expect(formatPtBrNumber(17.5)).toBe("17,5");
    expect(formatPtBrNumber(50)).toBe("50");
    expect(formatPtBrNumber(undefined)).toBe("");
  });
});

describe("NumberBoundInput", () => {
  it("keeps the comma the merchant typed instead of closing the digits over it", () => {
    const { onChange, input } = renderInput();
    fireEvent.change(input, { target: { value: "50,00" } });
    expect(input).toHaveValue("50,00");
    // The whole bug in one assertion: this used to be 5000.
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it("applies a decimal amount as itself", () => {
    const { onChange, input } = renderInput();
    fireEvent.change(input, { target: { value: "17,50" } });
    expect(onChange).toHaveBeenLastCalledWith(17.5);
  });

  it("applies a thousands-grouped amount", () => {
    const { onChange, input } = renderInput();
    fireEvent.change(input, { target: { value: "1.234,56" } });
    expect(onChange).toHaveBeenLastCalledWith(1234.56);
  });

  it("holds the applied bound while a decimal is half-typed", () => {
    const { onChange, input } = renderInput(50);
    fireEvent.change(input, { target: { value: "50," } });
    expect(input).toHaveValue("50,");
    // "50," parses to 50 — unchanged — so nothing new is applied and the list
    // does not re-query between the comma and the cents.
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("clears the bound when the field is emptied", () => {
    const { onChange, input } = renderInput(50);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("refuses letters rather than letting them move the number", () => {
    const { input } = renderInput();
    fireEvent.change(input, { target: { value: "5a0" } });
    expect(input).toHaveValue("50");
  });

  it("shows an applied bound with a comma, not a dot", () => {
    const { input } = renderInput(17.5);
    expect(input).toHaveValue("17,5");
  });

  it("snaps back to the applied bound on blur", () => {
    const { input } = renderInput(50);
    fireEvent.change(input, { target: { value: "50,," } });
    fireEvent.blur(input);
    expect(input).toHaveValue("50");
  });

  it("settles to the field's own precision, so it reads like the chip", () => {
    // `step: 0.01` is money declaring two decimals. Without this the field
    // rested on `17,5` while the chip said `R$ 17,50` — the same number written
    // two ways, on one screen.
    const { input } = renderInput(17.5, "R$", 0.01);
    fireEvent.blur(input);
    expect(input).toHaveValue("17,50");
  });

  it("groups thousands on settling, the same way it accepts them", () => {
    const { input } = renderInput(1234.56, "R$", 0.01);
    fireEvent.blur(input);
    expect(input).toHaveValue("1.234,56");
  });

  it("does not pad a field with no fractional step", () => {
    const { input } = renderInput(12, undefined, 1);
    fireEvent.blur(input);
    expect(input).toHaveValue("12");
  });

  it("shows a bound that arrives as a STRING, the way a restored URL hands it over", () => {
    // `?totalCents_gte=5000` comes back off the URL as text. Narrowing the prop
    // to `number` and dropping the rest emptied the field on every reload, and
    // then the next keystroke wrote a bound built from nothing — the browser
    // caught this where the unit tests, which only ever passed numbers, did not.
    const onChange = vi.fn();
    render(
      <NumberBoundInput
        label="De"
        value={"50" as unknown as number}
        onChange={onChange}
        testId="from-url"
      />,
    );
    expect(screen.getByTestId("from-url")).toHaveValue("50");
  });

  it("re-syncs when the bound is cleared from outside", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberBoundInput label="De" value={50} onChange={onChange} testId="amount" />,
    );
    expect(screen.getByTestId("amount")).toHaveValue("50");
    rerender(<NumberBoundInput label="De" value={undefined} onChange={onChange} testId="amount" />);
    expect(screen.getByTestId("amount")).toHaveValue("");
  });

  it("renders the unit as an adornment rather than parsing it out of the text", () => {
    renderInput(50, "R$");
    expect(screen.getByText("R$")).toBeInTheDocument();
  });
});
