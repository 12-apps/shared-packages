import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { formatCpf } from "../../card";

import { useCheckoutCopy } from "./copy-context";
import { PersonOutlineIcon, PlaceOutlinedIcon } from "./icons";
import { NoteIcon, TotalAmount, type CheckoutDeliverySummary, type OrderSummaryParts } from "./payment-summary";
import { useCheckoutComponents } from "./ui";

/**
 * The phone's head of the Pagamento step (FUT-3525, layout C): the amount big
 * at the top, then who pays, where it goes and the note as chips that wrap.
 */

const CHIP_ICON = { fontSize: 18, color: "text.secondary" } as const;

const CHIP_SX = {
  display: "inline-flex",
  alignItems: "center",
  gap: 1,
  minHeight: 44,
  maxWidth: "100%",
  px: 1.75,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: 999,
  bgcolor: "background.paper",
  color: "text.primary",
  font: "inherit",
  fontSize: "0.8125rem",
  cursor: "pointer",
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/** One chip: an icon, a fact, and the word that changes it. */
function Chip({
  icon,
  text,
  action,
  onClick,
  label,
  testId,
}: {
  icon: JSX.Element;
  text: ReactNode;
  action: string;
  onClick: () => void;
  label: string;
  testId: string;
}): JSX.Element {
  return (
    <Box component="button" type="button" onClick={onClick} aria-label={label} data-testid={testId} sx={CHIP_SX}>
      {icon}
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {text}
      </Box>
      <Box component="span" sx={{ color: "primary.main", fontWeight: 600, flex: "none" }}>
        {action}
      </Box>
    </Box>
  );
}

/** Who pays: the name and "CPF ✓", or the CPF typed this time, masked. */
function PayerChip({ payer }: { payer: NonNullable<OrderSummaryParts["payer"]> }): JSX.Element {
  const screens = useCheckoutCopy().screens;
  const cpf = payer.taxId?.trim() ? screens.payer.taxId(formatCpf(payer.taxId)) : screens.layout.taxIdOnFileShort;
  const who = payer.name ? screens.payer.payingAs(payer.name) : screens.payer.payingWithSavedDetails;
  return (
    <Box data-testid="checkout-payer" sx={{ display: "contents" }}>
      <Chip
        icon={<PersonOutlineIcon sx={CHIP_ICON} />}
        text={
          <>
            {payer.name ? `${payer.name} · ` : null}
            <span data-testid="checkout-payer-cpf">{cpf}</span>
          </>
        }
        action={screens.payer.changeAction}
        onClick={payer.onEdit}
        label={`${who} — ${screens.payer.changeAction}`}
        testId="checkout-payer-edit"
      />
    </Box>
  );
}

/** Where it goes: the street line only, and the way back to the address step. */
function AddressChip({ delivery }: { delivery: CheckoutDeliverySummary }): JSX.Element {
  const screens = useCheckoutCopy().screens;
  return (
    <Box data-testid="checkout-address" sx={{ display: "contents" }}>
      <Chip
        icon={<PlaceOutlinedIcon sx={CHIP_ICON} />}
        text={delivery.line1}
        action={screens.payer.changeAction}
        onClick={delivery.onEdit}
        label={`${delivery.line1} — ${screens.layout.changeAddress}`}
        testId="checkout-address-edit"
      />
    </Box>
  );
}

/**
 * The host's note control, drawn as the third chip while it is closed; once it
 * opens into a field, that field takes the whole row.
 */
function NoteChip({ note }: { note: ReactNode }): JSX.Element {
  return (
    <Box
      data-testid="checkout-note-slot"
      sx={{
        ...CHIP_SX,
        gap: 0.5,
        pr: 0.5,
        cursor: "auto",
        "&:has(textarea)": { flexBasis: "100%", display: "block", p: 0, border: 0, bgcolor: "transparent" },
        "&:has(textarea) > svg": { display: "none" },
      }}
    >
      <NoteIcon size={18} />
      {note}
    </Box>
  );
}

/** The amount, big, under "Total a pagar · N itens", the host's money rows under it. */
function PhoneTotal({ parts }: { parts: OrderSummaryParts }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box data-testid="payment-step-total" sx={{ display: "flex", flexDirection: "column", gap: 0.5, py: 1 }}>
      <Text variant="body" size="sm" color="secondary" as="span">
        {copy.totalDueCaption(parts.totalItems)}
      </Text>
      <TotalAmount totalLabel={parts.totalLabel} big />
      {parts.discountLines}
    </Box>
  );
}

export function PhoneOrderSummary({ parts }: { parts: OrderSummaryParts }): JSX.Element {
  const hasChips = Boolean(parts.payer || parts.delivery || parts.orderNote);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <PhoneTotal parts={parts} />
      {hasChips ? (
        <Box data-testid="checkout-chips" sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          {parts.payer ? <PayerChip payer={parts.payer} /> : null}
          {parts.delivery ? <AddressChip delivery={parts.delivery} /> : null}
          {parts.orderNote ? <NoteChip note={parts.orderNote} /> : null}
        </Box>
      ) : null}
    </Box>
  );
}
