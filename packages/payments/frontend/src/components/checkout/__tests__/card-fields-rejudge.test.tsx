// @vitest-environment jsdom
/**
 * The card form's fields, as every mount renders them (`NewCardForm`).
 *
 *  - FUT-4102: a field already red is re-judged when its value changes, so a
 *    browser autofill — one change event per field, no focus or blur — clears
 *    the red at once; a still-invalid value keeps a message; an empty field
 *    the shopper has not left is not red; the CVV is re-judged when the brand
 *    moves.
 *  - FUT-4103: a four-digit year pasted into the expiry keeps its last two
 *    digits, and the expiry carries no native `maxlength` to cut it first.
 *  - FUT-4107: the holder's `<input>` asks for capitals with no autocorrect and
 *    no spellcheck, in the default slot and in a binding that only merges
 *    `inputProps` onto the `<input>` (the `@12-apps/ui` shape).
 */
import { afterEach, describe, expect, it } from "vitest";

import { useState, type JSX } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

import { NewCardForm } from "../../../card/fields";
import { detectBrand, onlyDigits } from "../../../card/format";
import type { CardDetails, CardFieldErrors } from "../../../card/types";
import { CheckoutComponentsProvider, type CheckoutInputProps } from "../ui";

const EMPTY: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

function CardHost({ initialCard = EMPTY, initialErrors = {} }: { initialCard?: CardDetails; initialErrors?: CardFieldErrors }): JSX.Element {
  const [card, setCard] = useState<CardDetails>(initialCard);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>(initialErrors);
  return (
    <NewCardForm
      card={card}
      fieldErrors={fieldErrors}
      brand={detectBrand(onlyDigits(card.number))}
      setCard={setCard}
      setFieldErrors={setFieldErrors}
    />
  );
}

/**
 * A host `Input` that, like `@12-apps/ui`'s, drops unknown top-level props and
 * merges `inputProps` onto the `<input>`.
 */
function MergingInput({ value, error, helperText, onChange, onBlur, inputProps, ...rest }: CheckoutInputProps): JSX.Element {
  return (
    <label>
      <input
        {...inputProps}
        value={value}
        aria-invalid={error ? "true" : "false"}
        onChange={onChange}
        onBlur={onBlur}
        data-testid={rest["data-testid"]}
      />
      {helperText ? <small>{helperText}</small> : null}
    </label>
  );
}

const input = (testId: string): HTMLInputElement => screen.getByTestId(testId) as HTMLInputElement;

afterEach(() => cleanup());

describe("the expiry takes a four-digit year (FUT-4103)", () => {
  it.each(["12/2034", "12 / 2034"])("shows 12/34 when %s is pasted", async (pasted) => {
    render(<CardHost />);
    fireEvent.change(input("card-expiry"), { target: { value: pasted } });
    await waitFor(() => expect(input("card-expiry").value).toBe("12/34"));
  });

  it("carries no native maxlength that would cut the year before the formatter runs", () => {
    render(<CardHost />);
    expect(input("card-expiry").hasAttribute("maxlength")).toBe(false);
  });
});

describe("the holder's input asks for capitals with no autocorrect (FUT-4107)", () => {
  const expectHints = (node: HTMLInputElement): void => {
    expect(node.getAttribute("autocapitalize")).toBe("characters");
    expect(node.getAttribute("spellcheck")).toBe("false");
    expect(node.getAttribute("autocorrect")).toBe("off");
  };

  it("lands on the <input> in the package's default slot", () => {
    render(<CardHost />);
    expectHints(input("card-holder"));
  });

  it("lands on the <input> in a binding that merges inputProps only", () => {
    render(
      <CheckoutComponentsProvider components={{ Input: MergingInput }}>
        <CardHost />
      </CheckoutComponentsProvider>,
    );
    expectHints(input("card-holder"));
  });

  it("asks nothing of the other card fields", () => {
    render(<CardHost />);
    for (const testId of ["card-number", "card-expiry", "card-cvv"]) {
      expect(input(testId).hasAttribute("autocapitalize")).toBe(false);
    }
  });
});
