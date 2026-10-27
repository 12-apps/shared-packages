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
import { PT_BR_CHECKOUT_COPY } from "../pt-BR";
import { CheckoutComponentsProvider, type CheckoutInputProps } from "../ui";
import { onPageStore, renderList, stubClient } from "./list-harness";

/** The pt-BR pack's card-field refusals, which the form renders. */
const fields = () => PT_BR_CHECKOUT_COPY.card.fields;
const EMPTY: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };
const FIELDS = ["card-number", "card-holder", "card-expiry", "card-cvv"] as const;

/** What Chrome's autofill wrote on the storefront checkout (FUT-4102, measured). */
const AUTOFILLED: Record<(typeof FIELDS)[number], string> = {
  "card-number": "4111 1111 1111 1111",
  "card-holder": "THOMPSON F SILVA",
  "card-expiry": "12/34",
  "card-cvv": "123",
};

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
const invalid = (testId: string): string | null => input(testId).getAttribute("aria-invalid");
const helper = (testId: string): string | null | undefined => {
  const id = input(testId).getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
};
/** The shopper leaves the field (a focus first changes nothing the form reads). */
const blurEmpty = (testId: string): void => {
  fireEvent.blur(input(testId));
};

afterEach(() => cleanup());

describe("a red card field is re-judged when its value changes (FUT-4102)", () => {
  it("clears every blur-induced error when autofill fills all four fields with no focus or blur", async () => {
    render(<CardHost />);
    for (const testId of FIELDS) blurEmpty(testId);
    await waitFor(() => {
      for (const testId of FIELDS) expect(invalid(testId)).toBe("true");
    });
    for (const testId of FIELDS) fireEvent.change(input(testId), { target: { value: AUTOFILLED[testId] } });
    await waitFor(() => {
      for (const testId of FIELDS) expect(invalid(testId)).not.toBe("true");
    });
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(input("card-number").value).toBe("4111 1111 1111 1111");
  });

  it("clears every submit-written error when autofill fills the fields", async () => {
    render(
      <CardHost
        initialErrors={{ number: fields().numberRequired, holder: fields().holderRequired, expiry: fields().expiryIncomplete, cvv: fields().cvvRequired }}
      />,
    );
    for (const testId of FIELDS) expect(invalid(testId)).toBe("true");
    for (const testId of FIELDS) fireEvent.change(input(testId), { target: { value: AUTOFILLED[testId] } });
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0));
  });

  it("keeps a still-invalid value red, with the message that value earns", async () => {
    render(<CardHost />);
    blurEmpty("card-number");
    blurEmpty("card-expiry");
    await waitFor(() => expect(helper("card-number")).toBe(fields().numberRequired));
    fireEvent.change(input("card-number"), { target: { value: "4111" } });
    fireEvent.change(input("card-expiry"), { target: { value: "13/34" } });
    await waitFor(() => expect(helper("card-number")).toBe(fields().numberIncomplete));
    expect(invalid("card-number")).toBe("true");
    expect(helper("card-expiry")).toBe(fields().monthInvalid);
    expect(invalid("card-expiry")).toBe("true");
  });

  it("hands a field it cleared back to the blur: emptied again, it turns red only when left", async () => {
    render(<CardHost />);
    blurEmpty("card-holder");
    fireEvent.change(input("card-holder"), { target: { value: "ANA TESTE" } });
    await waitFor(() => expect(invalid("card-holder")).not.toBe("true"));
    fireEvent.change(input("card-holder"), { target: { value: "" } });
    await waitFor(() => expect(input("card-holder").value).toBe(""));
    expect(invalid("card-holder")).not.toBe("true");
    fireEvent.blur(input("card-holder"));
    await waitFor(() => expect(helper("card-holder")).toBe(fields().holderRequired));
  });

  it("does not judge an empty or partial field the shopper has not left", async () => {
    render(<CardHost />);
    fireEvent.change(input("card-number"), { target: { value: "4111" } });
    fireEvent.change(input("card-cvv"), { target: { value: "1" } });
    fireEvent.change(input("card-cvv"), { target: { value: "" } });
    await waitFor(() => expect(input("card-number").value).toBe("4111"));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    // Leaving it is still what judges it the first time.
    fireEvent.blur(input("card-number"));
    await waitFor(() => expect(helper("card-number")).toBe(fields().numberIncomplete));
  });

  it("re-judges a red CVV when the brand moves to one its length fits", async () => {
    render(<CardHost initialCard={{ ...EMPTY, cvv: "1234" }} />);
    fireEvent.blur(input("card-cvv"));
    await waitFor(() => expect(helper("card-cvv")).toBe(fields().cvvDigits(3)));
    fireEvent.change(input("card-number"), { target: { value: "3782 822463 10005" } });
    await waitFor(() => expect(invalid("card-cvv")).not.toBe("true"));
  });

  it("re-judges a red CVV when the brand moves to one its length does not fit", async () => {
    render(<CardHost initialCard={{ ...EMPTY, number: "3782 822463 10005", cvv: "12" }} />);
    fireEvent.blur(input("card-cvv"));
    await waitFor(() => expect(helper("card-cvv")).toBe(fields().cvvDigits(4)));
    fireEvent.change(input("card-number"), { target: { value: "4111 1111 1111 1111" } });
    await waitFor(() => expect(helper("card-cvv")).toBe(fields().cvvDigits(3)));
    expect(invalid("card-cvv")).toBe("true");
  });

  it("leaves a CVV that was never red unjudged when the brand moves", async () => {
    render(<CardHost initialCard={{ ...EMPTY, cvv: "123" }} />);
    fireEvent.change(input("card-number"), { target: { value: "3782 822463 10005" } });
    await waitFor(() => expect(input("card-number").value).toBe("3782 822463 10005"));
    expect(invalid("card-cvv")).not.toBe("true");
  });

  it("clears the red in a host binding too", async () => {
    render(
      <CheckoutComponentsProvider components={{ Input: MergingInput }}>
        <CardHost />
      </CheckoutComponentsProvider>,
    );
    for (const testId of FIELDS) fireEvent.blur(input(testId));
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(4));
    for (const testId of FIELDS) fireEvent.change(input(testId), { target: { value: AUTOFILLED[testId] } });
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0));
  });
});

describe("the payment list's card form (the storefront's mount)", () => {
  it("clears the red its blurs left once autofill fills the card", async () => {
    renderList({ config: onPageStore(), client: stubClient([]) });
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-option-CARD-radio"));
    await screen.findByTestId("card-number");
    for (const testId of FIELDS) blurEmpty(testId);
    await waitFor(() => {
      for (const testId of FIELDS) expect(invalid(testId)).toBe("true");
    });
    for (const testId of FIELDS) fireEvent.change(input(testId), { target: { value: AUTOFILLED[testId] } });
    await waitFor(() => {
      for (const testId of FIELDS) expect(invalid(testId)).not.toBe("true");
    });
    expect(input("card-holder").getAttribute("autocapitalize")).toBe("characters");
  });
});

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

  it("clears an expiry made red by an earlier blur once a four-digit year is pasted", async () => {
    render(<CardHost />);
    blurEmpty("card-expiry");
    await waitFor(() => expect(invalid("card-expiry")).toBe("true"));
    fireEvent.change(input("card-expiry"), { target: { value: "12/2034" } });
    await waitFor(() => expect(invalid("card-expiry")).not.toBe("true"));
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
