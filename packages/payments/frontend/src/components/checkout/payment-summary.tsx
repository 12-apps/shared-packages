import { Box } from "@mui/material";
import type { JSX, ReactNode } from "react";

import { formatCpf } from "../../card";

import { useCheckoutCopy } from "./copy-context";
import { PersonOutlineIcon, PlaceOutlinedIcon } from "./icons";
import { useCheckoutComponents } from "./ui";

/**
 * What the Pagamento step says about the ORDER around the payment (FUT-3525):
 * its lines and total, who pays, where it goes and the note. On a computer
 * it is a card beside the payment column ({@link OrderSummaryCard}); on a
 * phone the total heads the page and the rest are chips
 * ({@link PhoneOrderSummary}).
 */

/** One cart line, as the host words it — the package does no money math. */
export interface CheckoutSummaryLine {
  key: string;
  quantity: number;
  name: string;
  /** The line's total, formatted by the host. */
  totalLabel: string;
}

/** Where a delivery goes, and the host's way back to change it. */
export interface CheckoutDeliverySummary {
  /** "Rua Augusta, 1500 · ap 42" — street, number and complement. */
  line1: string;
  /** "Consolação, São Paulo" — district and city. Optional. */
  line2?: string;
  /** Back to the host's address step. */
  onEdit: () => void;
}

/** Everything the summary shows. Each part is optional and hides itself when absent. */
export interface OrderSummaryParts {
  totalLabel: string;
  totalItems: number;
  /** The host's discount, fee and delivery lines under the total (FUT-246). */
  discountLines?: ReactNode;
  lines?: CheckoutSummaryLine[];
  /** Who is paying — only for a flow whose Dados step was skipped (FUT-465). */
  payer?: { name?: string; taxId?: string; onEdit: () => void };
  delivery?: CheckoutDeliverySummary;
  /** The host's note control, mounted as it is. */
  orderNote?: ReactNode;
}

/** Read by a screen reader, not drawn. */
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/** "Alterar" as the prototype's top-aligned link on the card's edge, not a padded button. */
const EDIT_SX = { flex: "none", alignSelf: "flex-start", mt: -0.75, mr: -1 } as const;

const ROW_SX = { display: "flex", gap: 1.5, alignItems: "flex-start" } as const;
const ICON_SX = {
  fontSize: 20,
  color: "text.secondary",
  flex: "0 0 auto",
  mt: 0.25,
} as const;

export function NoteIcon({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 24 24"
      sx={{
        width: size,
        height: size,
        flex: "0 0 auto",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        color: "text.secondary",
      }}
    >
      <path d="M4 4h16v12H8l-4 4z" />
    </Box>
  );
}

/** The amount, the one number the whole step is about. */
export function TotalAmount({
  totalLabel,
  big,
}: {
  totalLabel: string;
  big: boolean;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  return (
    <Box
      sx={{
        "&& > *": {
          fontSize: big ? "2.5rem" : "1.625rem",
          lineHeight: 1.1,
          letterSpacing: big ? "-0.02em" : 0,
        },
      }}
    >
      <Text
        variant="heading"
        size="md"
        weight="bold"
        color={big ? undefined : "primary"}
        as="span"
        data-testid="pay-bar-total"
      >
        {totalLabel}
      </Text>
    </Box>
  );
}

function PayerRow({
  payer,
}: {
  payer: NonNullable<OrderSummaryParts["payer"]>;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.payer;
  const cpf = payer.taxId?.trim()
    ? copy.taxId(formatCpf(payer.taxId))
    : copy.taxIdAlreadyKnown;
  return (
    <Box
      data-testid="checkout-payer"
      sx={ROW_SX}
      aria-label={
        payer.name ? copy.payingAs(payer.name) : copy.payingWithSavedDetails
      }
      role="group"
    >
      <PersonOutlineIcon sx={ICON_SX} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" size="sm" as="p" data-testid="checkout-payer-name">
          {payer.name ?? copy.payingWithSavedDetails}
        </Text>
        <Text variant="body" size="xs" as="p" data-testid="checkout-payer-cpf">
          {cpf}
        </Text>
      </Box>
      <Box sx={EDIT_SX}>
      <Button
        variant="text"
        color="primary"
        size="sm"
        onClick={payer.onEdit}
        dataTestId="checkout-payer-edit"
      >
        {copy.changeAction}
      </Button>
      </Box>
    </Box>
  );
}

function AddressRow({
  delivery,
}: {
  delivery: CheckoutDeliverySummary;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens;
  return (
    <Box data-testid="checkout-address" sx={ROW_SX}>
      <PlaceOutlinedIcon sx={ICON_SX} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="body"
          size="sm"
          as="p"
          data-testid="checkout-address-line1"
        >
          {delivery.line1}
        </Text>
        {delivery.line2 ? (
          <Text variant="body" size="xs" as="p">
            {delivery.line2}
          </Text>
        ) : null}
      </Box>
      <Box sx={EDIT_SX}>
      <Button
        variant="text"
        color="primary"
        size="sm"
        onClick={delivery.onEdit}
        dataTestId="checkout-address-edit"
      >
        <span aria-hidden>{copy.payer.changeAction}</span>
        <Box component="span" sx={VISUALLY_HIDDEN}>
          {copy.layout.changeAddress}
        </Box>
      </Button>
      </Box>
    </Box>
  );
}

const DIVIDER = <Box sx={{ height: "1px", bgcolor: "divider" }} />;

/** The cart's lines, "2× X-Burger … R$ 36,00", when the host passed them. */
function SummaryLines({ lines }: { lines: CheckoutSummaryLine[] }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box component="ul" data-testid="checkout-summary-lines" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
      {lines.map((line) => (
        <Box component="li" key={line.key} sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
          <Text variant="body" size="sm" as="span">
            {copy.lineLabel(line.quantity, line.name)}
          </Text>
          <Text variant="body" size="sm" as="span">
            {line.totalLabel}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** "Total" and the amount on one line, the host's money rows under it. */
function SummaryTotal({ totalLabel, discountLines }: { totalLabel: string; discountLines?: ReactNode }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box data-testid="payment-step-total" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 2 }}>
        <Text variant="body" size="md" weight="semibold" as="span">
          {copy.total}
        </Text>
        <TotalAmount totalLabel={totalLabel} big={false} />
      </Box>
      {discountLines}
    </Box>
  );
}

/** The host's note control, on a row of its own with the note icon. */
function NoteRow({ note }: { note: ReactNode }): JSX.Element {
  return (
    <Box sx={{ ...ROW_SX, alignItems: "center" }}>
      <NoteIcon />
      <Box sx={{ flex: 1, minWidth: 0, "& .MuiButton-root, & button": { px: 0 } }}>{note}</Box>
    </Box>
  );
}

/**
 * The computer's summary card, beside the payment (FUT-3525, layout A).
 * Sticky, so the total and the address stay in view while the buyer fills
 * the card form.
 */
export function OrderSummaryCard({ parts }: { parts: OrderSummaryParts }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  const lines = parts.lines ?? [];
  const hasWho = Boolean(parts.payer || parts.delivery || parts.orderNote);
  return (
    <Box
      component="aside"
      aria-label={copy.summaryTitle}
      data-testid="checkout-summary"
      sx={{ position: "sticky", top: 24, display: "flex", flexDirection: "column", gap: 2, p: 2.75, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 2.5 }}
    >
      <Text variant="heading" size="md" weight="bold" as="h2">
        {copy.summaryTitle}
      </Text>
      {lines.length > 0 ? <SummaryLines lines={lines} /> : null}
      {lines.length > 0 ? DIVIDER : null}
      <SummaryTotal totalLabel={parts.totalLabel} discountLines={parts.discountLines} />
      {hasWho ? DIVIDER : null}
      {parts.payer ? <PayerRow payer={parts.payer} /> : null}
      {parts.delivery ? <AddressRow delivery={parts.delivery} /> : null}
      {parts.orderNote ? <NoteRow note={parts.orderNote} /> : null}
    </Box>
  );
}
