import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutComponents } from "../ui";

import type { PaymentListCopy } from "./types";

/**
 * Who is paying, when the store already holds their CPF (FUT-465): "Pagando
 * como … · CPF ✓ Alterar". "Alterar" reveals the CPF field at the top of
 * Pagamento (FUT-3685, E2 → E1) — never a Dados step: the list has none
 * (R9). Shown only while an online option is chosen and the CPF is not open.
 */
export function PayerLine({ copy, name, onChange }: {
  copy: PaymentListCopy;
  name: string;
  onChange: () => void;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  return (
    // Left-aligned, "Alterar" ~4px after "CPF ✓" and wrapping under it when
    // the name is long; the link keeps a 40px target and a visible focus ring.
    <Box data-testid="list-payer" sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", flexWrap: "wrap", columnGap: 0 }}>
      <Text variant="body" size="sm" color="secondary" as="span">
        {copy.payer(name)}
      </Text>
      <Box
        sx={{
          "& button": { textDecoration: "underline", minHeight: (t) => t.spacing(5), minWidth: 0, px: 0.5, py: 0 },
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
