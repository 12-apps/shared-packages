import { Box, useMediaQuery } from "@mui/material";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

import { useCheckoutComponents, type CheckoutInputProps } from "../ui";

import type { PaymentListCopy } from "./types";

/**
 * The CPF-or-CNPJ field's keyboard (FUT-590, the owner's option B).
 *
 * The field opens the NUMBER keyboard: a CPF and today's CNPJ are digits. The
 * Receita issues alphanumeric CNPJs from July 2026, so on a phone a quiet link
 * under the field — "Seu CNPJ tem letras? Usar teclado com letras" — switches
 * to the letters keyboard, and "Voltar ao teclado de números" switches back.
 *
 * On a computer there is no link: its physical keyboard already has letters.
 * "Computer" is read off the pointer, not the width — a mouse that hovers
 * means a keyboard is attached, a narrow desktop window included, and a
 * tablet's touch screen means the on-screen keyboard is the one that opens.
 */
export type TaxIdKeyboard = NonNullable<CheckoutInputProps["inputMode"]>;

/** A pointer that hovers and aims finely: a mouse or a trackpad, so a physical keyboard. */
const PHYSICAL_KEYBOARD_QUERY = "(hover: hover) and (pointer: fine)";

/** The document field's `<input>`: its test id is the one the slot contract lands on it. */
const TAX_ID_INPUT = '[data-testid="list-buyer-taxId"]';

/**
 * The keyboard as the field's `Input` takes it: at the top level, and again in
 * `inputProps` — `@12-apps/ui`'s `Input` put a top-level `inputMode` on its
 * root `<div>` until FUT-1440, where it raised no keyboard at all, while every
 * binding merges `inputProps` onto the `<input>`.
 */
export function keyboardProps(mode: TaxIdKeyboard): { inputMode: TaxIdKeyboard; inputProps: { inputMode: TaxIdKeyboard } } {
  return { inputMode: mode, inputProps: { inputMode: mode } };
}

/**
 * Which keyboard the document field opens, whether the switch is offered, and
 * the switch itself. After a switch the buyer is put back in the field — out
 * and in again, since a phone reads `inputmode` as the field takes the focus —
 * so the new keyboard is the one that opens without another tap.
 */
export function useTaxIdKeyboard(
  scope: RefObject<HTMLElement | null>,
  copy: PaymentListCopy["buyer"],
): { mode: TaxIdKeyboard; offered: boolean; onSwitch: () => void } {
  const [mode, setMode] = useState<TaxIdKeyboard>("numeric");
  const [switches, setSwitches] = useState(0);
  const onAComputer = useMediaQuery(PHYSICAL_KEYBOARD_QUERY, { noSsr: true });
  const offered = !onAComputer && Boolean(copy.lettersKeyboard && copy.numbersKeyboard);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const input = scope.current?.querySelector<HTMLInputElement>(TAX_ID_INPUT);
    input?.blur();
    input?.focus();
  }, [switches, scope]);
  return {
    mode: offered ? mode : "numeric",
    offered,
    onSwitch: () => {
      setMode((current) => (current === "numeric" ? "text" : "numeric"));
      setSwitches((count) => count + 1);
    },
  };
}

/**
 * The quiet link under the document field. Flush with the field's left edge,
 * in the neutral ink of "Manter o documento salvo" beside it: the brand's
 * primary reads as part of the red complaint right above it. A press does not
 * take the focus off the field, so the buyer's place in it is kept.
 */
export function TaxIdKeyboardLink({ mode, copy, onSwitch }: {
  mode: TaxIdKeyboard;
  copy: PaymentListCopy["buyer"];
  onSwitch: () => void;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box
      onMouseDown={(event) => event.preventDefault()}
      sx={{ alignSelf: "flex-start", "& button": { textDecoration: "underline", px: 0, py: 0, minWidth: 0, minHeight: (t) => t.spacing(3), textAlign: "left" } }}
    >
      <Button variant="text" color="neutral" size="sm" onClick={onSwitch} dataTestId="list-cpf-keyboard">
        {mode === "numeric" ? copy.lettersKeyboard : copy.numbersKeyboard}
      </Button>
    </Box>
  );
}
