import { Box, useMediaQuery } from "@mui/material";
import { useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";

import { useCheckoutComponents, type CheckoutInputProps } from "../ui";

/**
 * The link's two sentences — the checkout's `buyer` pack and the activation's
 * `taxId` pack both carry them. Absent ⇒ no link, the number keyboard only.
 */
interface KeyboardSwitchCopy {
  lettersKeyboard?: string;
  numbersKeyboard?: string;
}

/**
 * A quiet link's geometry, in spacing units: the line it LOOKS (24px), the
 * target a finger gets (40px), and what it gives back below. Half the extra
 * height above keeps the text where it sat; giving back only a quarter below
 * means that in a column 12px apart (1.5) the next link's band starts exactly
 * where this one's ends: 1.5 − 0.5 − 1 = 0, touching, never overlapping.
 */
const LINK_LINE = 3;
const LINK_HIT = 5;
const LINK_BELOW = -0.5;

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

/** The checkout's document `<input>`: its test id is the one the slot contract lands on it. */
const TAX_ID_INPUT = '[data-testid="list-buyer-taxId"]';

/** What a phone's keyboard is told about a document: no spell-check, no autocorrect, capitals (FUT-590). */
const DOCUMENT_HINTS = { spellCheck: false, autoCorrect: "off", autoCapitalize: "characters" } as const;

/**
 * The keyboard as the field's `Input` takes it: at the top level, and again in
 * `inputProps` — `@12-apps/ui`'s `Input` put a top-level `inputMode` on its
 * root `<div>` until FUT-1440, where it raised no keyboard at all, while every
 * binding merges `inputProps` onto the `<input>`.
 */
export function keyboardProps(mode: TaxIdKeyboard): {
  inputMode: TaxIdKeyboard;
  inputProps: { inputMode: TaxIdKeyboard } & typeof DOCUMENT_HINTS;
} {
  // A CNPJ's `01DE` is no word: without these the browser underlines a valid
  // document in red and a phone "corrects" or lower-cases its letters.
  return { inputMode: mode, inputProps: { inputMode: mode, ...DOCUMENT_HINTS } };
}

/**
 * A document that GAINS a letter — an alphanumeric CNPJ pasted or autofilled,
 * or one on file the field opens on — moves the field to the letters keyboard
 * by itself, so the link then offers the way back (FUT-590: one tap fewer).
 * Only on the change: a buyer who then taps back to numbers keeps that choice
 * while the letters stay.
 */
function useLettersOnceTheyArrive(value: string, setMode: (mode: TaxIdKeyboard) => void): void {
  const hasLetters = /[A-Z]/i.test(value);
  const had = useRef(false);
  useEffect(() => {
    if (hasLetters && !had.current) setMode("text");
    had.current = hasLetters;
  }, [hasLetters, setMode]);
}

/**
 * Which keyboard the document field opens, whether the switch is offered, and
 * the switch itself. After a switch the buyer is put back in the field — out
 * and in again, since a phone reads `inputmode` as the field takes the focus —
 * so the new keyboard is the one that opens without another tap.
 */
export function useTaxIdKeyboard(
  scope: RefObject<HTMLElement | null>,
  copy: KeyboardSwitchCopy,
  value: string,
  input: string = TAX_ID_INPUT,
): { mode: TaxIdKeyboard; offered: boolean; onSwitch: () => void } {
  const [mode, setMode] = useState<TaxIdKeyboard>("numeric");
  useLettersOnceTheyArrive(value, setMode);
  const [switches, setSwitches] = useState(0);
  const onAComputer = useMediaQuery(PHYSICAL_KEYBOARD_QUERY, { noSsr: true });
  const offered = !onAComputer && Boolean(copy.lettersKeyboard && copy.numbersKeyboard);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const field = scope.current?.querySelector<HTMLInputElement>(input);
    field?.blur();
    field?.focus();
  }, [switches, scope, input]);
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
 * A quiet link under a field — "Seu CNPJ tem letras?", "Manter o documento
 * salvo": flush with the field's left edge, underlined, in neutral ink (the
 * brand's primary reads as part of a red complaint right above it).
 *
 * Its TEXT is one line tall; its TARGET is 40px, the least a finger can hit
 * (FUT-590 UI review). The extra height is invisible, taken back by negative
 * margins (see LINK_BELOW), so the text stays where it sat and two such links
 * in a column 12px apart touch without overlapping. `keepFocus` stops a press from
 * taking the focus off the field above, so the buyer's place in it is kept.
 */
export function QuietLink({ onClick, dataTestId, keepFocus = false, children }: {
  onClick: () => void;
  dataTestId: string;
  keepFocus?: boolean;
  children: ReactNode;
}): JSX.Element {
  const { Button } = useCheckoutComponents();
  return (
    <Box
      data-testid={`${dataTestId}-band`}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      sx={(t) => ({
        alignSelf: "flex-start",
        mt: t.spacing((LINK_LINE - LINK_HIT) / 2),
        mb: t.spacing(LINK_BELOW),
        "& button": { textDecoration: "underline", px: 0, py: 0, minWidth: 0, minHeight: t.spacing(LINK_HIT), textAlign: "left" },
      })}
    >
      <Button variant="text" color="neutral" size="sm" onClick={onClick} dataTestId={dataTestId}>
        {children}
      </Button>
    </Box>
  );
}

/** The document field's keyboard switch (FUT-590, option B). */
export function TaxIdKeyboardLink({ mode, copy, onSwitch, dataTestId = "list-cpf-keyboard" }: {
  mode: TaxIdKeyboard;
  copy: KeyboardSwitchCopy;
  onSwitch: () => void;
  dataTestId?: string;
}): JSX.Element {
  return (
    <QuietLink onClick={onSwitch} dataTestId={dataTestId} keepFocus>
      {mode === "numeric" ? copy.lettersKeyboard : copy.numbersKeyboard}
    </QuietLink>
  );
}
