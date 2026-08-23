import { Box } from "@mui/material";
import type { JSX } from "react";

import { formatCpf } from "../../card";

import { useCheckoutCopy } from "./copy-context";
import { PersonOutlineIcon } from "./icons";
import type { PayerSummaryCopy } from "./screens-copy";
import { useCheckoutComponents } from "./ui";

/** What the CPF line reads, given whether the buyer typed one this time. */
function cpfLabel(copy: PayerSummaryCopy, taxId: string | undefined): string {
  return taxId?.trim() ? copy.taxId(formatCpf(taxId)) : copy.taxIdAlreadyKnown;
}

/**
 * "Pagando como … " — who the charge will name, shown at the top of Pagamento
 * for a buyer whose Dados step was skipped (FUT-465).
 *
 * Skipping that step is right (it existed to collect a CPF the store already
 * has) but it silently removed the last place a buyer could see WHICH identity
 * is about to be charged, or use a different CPF for one purchase. This states
 * both, and "Alterar" reopens Dados so they can type another — the server
 * prefers a CPF that was sent over the saved one, so a typed CPF simply wins.
 *
 * The saved CPF is never shown, because the client never receives it: the
 * profile API answers `hasTaxId` only. A CPF the buyer typed HERE is theirs and
 * already on screen, so that one is echoed back masked.
 *
 * Renders nothing without `onEdit`, which is the flow's way of saying the buyer
 * filled the Dados step in themselves: they have already seen these details on
 * the previous screen, and the header's back link returns them to it.
 */
export function PayerSummary({
  name,
  taxId,
  onEdit,
}: {
  name?: string;
  /** A CPF typed in this checkout, if any — else the saved one is in play. */
  taxId?: string;
  /** Absent ⇒ Dados was NOT skipped, so there is nothing to restate. */
  onEdit?: () => void;
}): JSX.Element | null {
  const { Button, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.payer;
  if (!onEdit) return null;

  return (
    <Box
      data-testid="checkout-payer"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <PersonOutlineIcon sx={{ fontSize: 20, color: "text.secondary", flex: "0 0 auto" }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" size="sm" as="p" data-testid="checkout-payer-name">
          {name ? copy.payingAs(name) : copy.payingWithSavedDetails}
        </Text>
        <Text variant="caption" size="xs" color="secondary" as="p" data-testid="checkout-payer-cpf">
          {cpfLabel(copy, taxId)}
        </Text>
      </Box>
      <Button
        variant="text"
        color="primary"
        size="sm"
        onClick={onEdit}
        dataTestId="checkout-payer-edit"
      >
        {copy.changeAction}
      </Button>
    </Box>
  );
}
