import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "../ui";

import type { PaymentListCopy } from "./types";

/**
 * The row's room above and below its text, in theme spacing (FUT-4352).
 *
 * "Alterar" is as tall as its line; its 40px target (FUT-3711) is a
 * pseudo-element that takes no layout height. The target starts
 * `ROOM_ABOVE` over Alterar — at the row's own top edge on the first line, so
 * it never reaches up into the gap the summary toggle's box already reaches 6px
 * into — and runs 40px down from there: through the line, the room below, and
 * ~5px of the bar's 8px gap below, where no control is. On a later line it reaches up
 * over the line of text above instead, which is not a control.
 */
const ROOM_ABOVE = 1;
const ROOM_BELOW = 0.75;

/**
 * The payer sentence with its document tail — "· CPF ✓" — and "Alterar" kept on
 * one line as one unit: the dot never dangles at a line's end, the mark never
 * wraps alone, and "Alterar" always follows the last words rather than
 * starting a line of its own. The characters are the copy's, unchanged.
 */
function sentenceParts(text: string): { head: string; tail: string } {
  const words = text.split(" ");
  // The last two words ("CPF ✓"), and the separator before them when it is a lone mark ("·").
  const cut = words.length > 2 && !/[\p{L}\p{N}]/u.test(words[words.length - 3] ?? "") ? 3 : 2;
  if (words.length <= cut) return { head: "", tail: text };
  return { head: `${words.slice(0, -cut).join(" ")} `, tail: words.slice(-cut).join(" ") };
}

/**
 * Who is paying, when the store already holds their CPF (FUT-465): "Pagando
 * como … · CPF ✓ Alterar". "Alterar" reveals the CPF field at the top of
 * Pagamento (FUT-3685, E2 → E1) — never a Dados step: the list has none
 * (R9). Shown only while an online option is chosen and the CPF is not open.
 */
export function PayerLine({ copy, name, document = null, onChange }: {
  copy: PaymentListCopy;
  name: string;
  /** The kind on file when the host passed its value — "CNPJ ✓" for a company's (FUT-4080). */
  document?: "CPF" | "CNPJ" | null;
  onChange: () => void;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const { head, tail } = sentenceParts(copy.payer(name, document));
  return (
    // One run of text: the name wraps as text does, and "· CPF ✓ Alterar" moves
    // to the next line together when it does not fit after it.
    <Box data-testid="list-payer" sx={{ pt: ROOM_ABOVE, pb: ROOM_BELOW }}>
      {/* A block of its own, so the line is as tall as the sentence's own line, not the bar's body text. */}
      <Text variant="body" size="sm" color="secondary" as="span" style={{ display: "block" }}>
        {head}
        <Box component="span" sx={{ whiteSpace: "nowrap" }}>
          {tail}
          {/* A real space, so the copied text reads "✓ Alterar"; at half size, so the line still fits at 390. */}
          <Box component="span" sx={{ fontSize: "0.5em" }}>{" "}</Box>
          <Box
            component="span"
            sx={{
              display: "inline-flex",
              verticalAlign: "baseline",
              // A link in the line, as tall as the line: the 40px target is the
              // pseudo-element, so it takes no layout height (FUT-3711).
              "& button": {
                textDecoration: "underline",
                minHeight: 0,
                minWidth: 0,
                height: "auto",
                p: 0,
                lineHeight: "inherit",
                // The sentence's own tracking, not a button label's: a link in the line (as the bar's action does).
                letterSpacing: "normal",
                verticalAlign: "baseline",
                position: "relative",
                // A host button may clip its own box (for its ripple); the target reaches past it.
                overflow: "visible",
              },
              "& button::before": {
                content: '""',
                position: "absolute",
                left: 0,
                right: 0,
                top: (t) => t.spacing(-ROOM_ABOVE),
                height: (t) => t.spacing(5),
              },
              "& button:focus-visible": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
            }}
          >
            <Button variant="text" color="primary" size="sm" onClick={onChange} dataTestId="list-payer-change">
              {copy.payerChange}
            </Button>
          </Box>
        </Box>
      </Text>
    </Box>
  );
}
