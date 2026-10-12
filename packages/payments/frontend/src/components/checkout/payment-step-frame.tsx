import { Box } from "@mui/material";
import { useId, type JSX, type ReactNode } from "react";

import { displayTotals } from "./checkout-totals";
import { useCheckoutCopy } from "./copy-context";
import { MethodTabs, methodPanelId, methodTabId } from "./method-tabs";
import { PANEL_PAD_PHONE } from "./payment-step-layout";
import {
  OrderSummaryCard,
  type CheckoutDeliverySummary,
  type CheckoutSummaryLine,
  type OrderSummaryParts,
} from "./payment-summary";
import { PhoneOrderSummary } from "./payment-summary-phone";
import type { CheckoutOrder, PaymentMethod } from "./types";
import { useCheckoutComponents } from "./ui";

/**
 * The Pagamento step's frame (FUT-3525): the computer's payment column with
 * the order summary beside it, or the phone's single column with the total
 * and chips on top — around ONE panel that holds the payment body.
 */

/** What the step knows about the amount: the charge's, the balance's, the cart's. */
interface StepMoney {
  order: CheckoutOrder | null;
  cartTotals?: { totalLabel: string; totalItems: number };
  totalOverride?: { label: string; items: number };
  discountLines?: ReactNode;
}

/**
 * The Pagamento step's own money line (FUT-1179), and everything the order
 * summary shows beside it (FUT-3525).
 *
 * THE RAISED ORDER'S TOTAL WINS, exactly as the confirmation screen's does
 * (`statusTotalLabel`). Once a charge exists, that charge's amount is what is
 * being taken — a repriced cart, or an order resumed from a parked entry, makes
 * the cart's total a different number from the one about to leave the buyer's
 * account. Showing the cart's number above a QR for the order's would be this
 * ticket's own defect in a new place: an amount on screen that is not the
 * amount being charged.
 *
 * The item COUNT stays the cart's — an order carries no line count, and the
 * caption is a description of the basket rather than of the charge.
 *
 * `null` when the host supplied no totals and no order — a step that would
 * otherwise print "Total ·" with a blank beside it is worse than the silence
 * FUT-1179 is about. Every host mounting `CheckoutFlow` gets them; only a
 * hand-composed step can be missing them.
 */
export function summaryParts(
  money: StepMoney,
  extras: SummaryExtras,
): OrderSummaryParts | null {
  const { order, cartTotals, totalOverride, discountLines } = money;
  if (!cartTotals && !totalOverride && !order) return null;
  const { label, items } = displayTotals(
    totalOverride,
    cartTotals ?? { totalLabel: "", totalItems: 0 },
  );
  return {
    totalLabel: order?.totalLabel ?? label,
    totalItems: items,
    // Suppressed while settling a balance: those totals come from the frozen
    // ticket, not the cart — and so do its lines.
    discountLines: totalOverride ? undefined : discountLines,
    lines: totalOverride ? undefined : extras.lines,
    payer: extras.payer,
    delivery: extras.delivery,
    orderNote: extras.orderNote,
  };
}

/** The order facts a host may hand the summary, beyond the money (FUT-3525). */
interface SummaryExtras {
  lines?: CheckoutSummaryLine[];
  payer?: OrderSummaryParts["payer"];
  delivery?: CheckoutDeliverySummary;
  orderNote?: ReactNode;
}

/**
 * The panel under the method tabs: on a computer a card the chosen folder tab
 * opens into (no top border, so the tab and the card are one shape); on a
 * phone a rounded card under the pill. Empty — nothing chosen, nothing raised
 * — it draws nothing, so an unanswered choice is not an empty box.
 */
function panelSx(wide: boolean, attached: boolean, filled: boolean) {
  const base = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    "&:empty": { display: "none" },
  } as const;
  if (!filled) return base;
  if (wide) {
    return {
      ...base,
      p: 3,
      bgcolor: "background.paper",
      border: "1px solid",
      borderColor: "divider",
      borderTop: attached ? 0 : "1px solid",
      borderTopColor: "divider",
      borderRadius: attached ? "0 0 10px 10px" : "10px",
      // Flush under the folder tabs: the column's gap would open a seam
      // between the chosen tab and the card it opens into.
      mt: attached ? -2 : 0,
    } as const;
  }
  return { ...base, p: `${PANEL_PAD_PHONE}px`, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 4 } as const;
}

/** What the frame needs to draw the method tabs. */
interface FrameTabs {
  show: boolean;
  method: PaymentMethod | null;
  onChange: (method: PaymentMethod) => void;
  cardUnavailable: boolean;
  offered: PaymentMethod[] | null;
}

/** The computer's heading over the tabs, at the prototype's 26px whatever the host's md is. */
function PayHeading(): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  return (
    <Box sx={{ "&& > *": { fontSize: "1.625rem", lineHeight: 1.2, m: 0 } }}>
      <Text variant="heading" size="md" weight="bold" as="h2">
        {copy.payHeading}
      </Text>
    </Box>
  );
}

const WIDE_GRID = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 4, alignItems: "start" } as const;
const NARROW_COLUMN = { display: "flex", flexDirection: "column", width: "100%", maxWidth: 560, mx: "auto" } as const;

/**
 * The panel's label: only a tab that is actually chosen — a card the store
 * cannot charge stays disabled and unselected even while `method` names it.
 */
function panelLabel(tabs: FrameTabs, idBase: string): string | undefined {
  if (!tabs.show || !tabs.method) return undefined;
  if (tabs.method === "CARD" && tabs.cardUnavailable) return undefined;
  return methodTabId(idBase, tabs.method);
}

/** Over the tabs: the computer's heading, or the phone's total and chips. */
function StepHead({ wide, parts }: { wide: boolean; parts: OrderSummaryParts | null }): JSX.Element | null {
  if (wide) return <PayHeading />;
  return parts ? <PhoneOrderSummary parts={parts} /> : null;
}

/**
 * The step's frame. The panel — and so the payment body inside it — keeps ONE
 * place in the tree whichever layout is showing: a tablet turned on its side
 * changes the frame, and remounting the card form there would throw away what
 * the buyer typed.
 */
export function PaymentStepFrame({
  wide,
  parts,
  tabs,
  filled,
  children,
}: {
  wide: boolean;
  parts: OrderSummaryParts | null;
  tabs: FrameTabs;
  /** A method is chosen or an order raised — the panel has something to draw. */
  filled: boolean;
  children: ReactNode;
}): JSX.Element {
  const idBase = useId();
  const labelledBy = panelLabel(tabs, idBase);
  return (
    <Box data-testid="payment-step" data-layout={wide ? "wide" : "narrow"} sx={wide ? WIDE_GRID : NARROW_COLUMN}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: wide ? 2 : 2.5, minWidth: 0 }}>
        <StepHead wide={wide} parts={parts} />
        {tabs.show ? (
          <MethodTabs
            idBase={idBase}
            shape={wide ? "folder" : "pill"}
            value={tabs.method}
            onChange={tabs.onChange}
            cardUnavailable={tabs.cardUnavailable}
            offered={tabs.offered}
          />
        ) : null}
        <Box
          id={methodPanelId(idBase)}
          role={labelledBy ? "tabpanel" : undefined}
          aria-labelledby={labelledBy}
          data-testid="checkout-method-panel"
          sx={panelSx(wide, tabs.show, filled)}
        >
          {children}
        </Box>
      </Box>
      {wide && parts ? <OrderSummaryCard parts={parts} /> : null}
    </Box>
  );
}
