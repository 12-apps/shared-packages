import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "../ui";

import type { PaymentListCopy } from "./types";

/**
 * How far the 40px "Alterar" target reaches past its own text line, above and
 * below, in theme spacing (FUT-3711): the row keeps that much room around it,
 * so no neighbour's box — the payer text above a wrapped "Alterar", the summary
 * toggle above the row — overlaps the target (FUT-4352).
 */
const TARGET_REACH = 1;

/**
 * The payer sentence with its last two words kept on one line ("CPF ✓"), so the
 * mark never wraps alone. The words themselves are the copy's, unchanged.
 */
function KeepTail({ text }: { text: string }): JSX.Element {
  const words = text.split(" ");
  if (words.length < 3) return <>{text}</>;
  const tail = words.slice(-2).join(" ");
  return (
    <>
      {`${words.slice(0, -2).join(" ")} `}
      <Box component="span" sx={{ whiteSpace: "nowrap" }}>{tail}</Box>
    </>
  );
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
  return (
    // Two flex items on a wrapping row, aligned on their text's baseline: the
    // sentence (which may wrap, and shrinks) and "Alterar" (which never shrinks,
    // so it wraps whole, flush left under the sentence). The column gap is the
    // ~4px between them; the row's padding and its line gap hold the target's reach.
    <Box
      data-testid="list-payer"
      sx={{ display: "flex", alignItems: "baseline", justifyContent: "flex-start", flexWrap: "wrap", columnGap: 0.5, rowGap: TARGET_REACH, py: TARGET_REACH }}
    >
      <Text variant="body" size="sm" color="secondary" as="span" style={{ minWidth: 0 }}>
        <KeepTail text={copy.payer(name, document)} />
      </Text>
      <Box
        sx={{
          flexShrink: 0,
          // The 40px target reaches into the room above and below rather than making the
          // line 40px tall: a row of text in the bar, not a row of button (FUT-3711).
          "& button": { textDecoration: "underline", minHeight: (t) => t.spacing(5), height: (t) => t.spacing(5), minWidth: 0, px: 0, py: 0, my: -TARGET_REACH },
          "& button:focus-visible": { outline: (t) => `${t.spacing(0.25)} solid ${t.palette.primary.main}`, outlineOffset: (t) => t.spacing(0.25) },
        }}
      >
        <Button variant="text" color="primary" size="sm" onClick={onChange} dataTestId="list-payer-change">
          {copy.payerChange}
        </Button>
      </Box>
    </Box>
  );
}
