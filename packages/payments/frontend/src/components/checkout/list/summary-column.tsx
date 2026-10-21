import { Box } from "@mui/material";
import { Suspense, createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useCheckoutCopy } from "../copy-context";
import type { CheckoutSummaryLine } from "../payment-summary";
import { useCheckoutLayout } from "../payment-step-layout";
import { useCheckoutComponents } from "../ui";

import { PartBoundary, deferredPart } from "./lazy-body";
import type { ColumnBodyProps } from "./summary-column-body";

/**
 * Where the bar's content goes on a computer (FUT-3685, L4): into the
 * "Resumo do pedido" column — an element the column draws, which the bar's
 * content is portalled into — or `null` on a phone, where the bar stays the
 * host's sticky `ActionBar` (L2).
 */
const ColumnTarget = createContext<{ element: HTMLElement | null } | null>(null);

const SummaryColumnTarget = ColumnTarget.Provider;

/**
 * `null` for the bar (a phone); otherwise the column's element to portal the
 * bar's content into — itself `null` for the one render before the column
 * mounts, when nothing is drawn rather than a bar that would flash.
 */
export function useSummaryColumnTarget(): { element: HTMLElement | null } | null {
  return useContext(ColumnTarget);
}

/** The prototype's 680px steps column and 360px summary column, on the theme's spacing scale. */
const STEPS_MAX = 85;
const COLUMN_WIDTH = 45;

/** The column's loaded half (FUT-3711): lines, money rows, "Total", the credit rows. */
const ColumnPart = deferredPart<ColumnBodyProps>(async () => (await import("./summary-column-body")).SummaryBody);

/** The loaded half, drawn through the host's loader. */
function DeferredBody(props: ColumnBodyProps): JSX.Element {
  const Body = ColumnPart.usePart();
  return <Body {...props} />;
}

/**
 * "Resumo do pedido" (T20). The frame, the heading and the pay-button slot are
 * drawn at once and never change element (FUT-3711): the bar's content is
 * portalled into that ONE slot from the first render, so the body landing —
 * lines, money rows, "Total" — moves nothing out from under it (the focus on
 * "Pagar", the host's extras, a 5-second bar counting). Only the body is a
 * chunk of its own, which a phone never draws and so never parses; a body that
 * fails to load leaves the frame and the button, and is tried once more.
 */
function SummaryColumn({ slot, ...body }: ColumnBodyProps & { slot: (element: HTMLElement | null) => void }): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.layout;
  const forget = ColumnPart.useForget();
  return (
    <Box
      component="aside"
      aria-label={copy.summaryTitle}
      data-testid="list-summary-column"
      sx={{ display: "flex", flexDirection: "column", gap: 1.75, p: 2.75, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3.5 }}
    >
      <Text variant="heading" size="md" weight="bold" as="h2" style={{ margin: 0 }}>
        {copy.summaryTitle}
      </Text>
      <PartBoundary fallback={null} retry={forget}>
        <Suspense fallback={<Box data-testid="list-summary-loading" sx={{ display: "none" }} />}>
          <DeferredBody {...body} />
        </Suspense>
      </PartBoundary>
      <Box ref={slot} data-testid="list-summary-action" sx={{ display: "flex", flexDirection: "column" }} />
    </Box>
  );
}

/**
 * The list face's layout (FUT-3685, L4), in one of three shapes:
 *
 *  - the HOST lays out the page (`hostTarget` given — `paymentList.summaryTarget`):
 *    the "Resumo do pedido" column is portalled into the host's element, beside
 *    the host's own step cards, and the bar's action lands in it. While the
 *    element is `null` (not mounted yet) the bar draws nothing rather than flash;
 *  - a computer, the host silent: the step and the column side by side, here —
 *    the steps at most ~680px, the column ~360px and sticky;
 *  - a phone: the step alone, over the host's bar (L2).
 *
 * The step sits at the SAME place in the tree in all three (FUT-3711): the
 * same two wrappers, only their styles and the column beside them change. A
 * host crossing its two-column threshold (an iPad rotated between 1366 and
 * 1024) or the frame crossing `WIDE_CHECKOUT_MIN` re-lays the step out — it
 * never remounts it, so a typed card and the chosen row survive.
 *
 * Only the list face is laid out this way: the Pix screen and the hand-off keep
 * their bar (K9).
 */
export function ListLayout({ hostTarget, lines, moneyLines, totalLabel, credit, children }: {
  hostTarget: HTMLElement | null | undefined;
  lines?: CheckoutSummaryLine[];
  moneyLines?: ReactNode;
  totalLabel: string;
  credit?: ColumnBodyProps["credit"];
  children: ReactNode;
}): JSX.Element {
  const wide = useCheckoutLayout()?.wide ?? false;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const target = useMemo(() => ({ element: slot }), [slot]);
  const hosted = hostTarget !== undefined;
  const sideBySide = !hosted && wide;
  const column = <SummaryColumn lines={lines} moneyLines={moneyLines} totalLabel={totalLabel} credit={credit} slot={setSlot} />;
  return (
    <SummaryColumnTarget value={hosted || sideBySide ? target : null}>
      <Columns sideBySide={sideBySide} column={column}>
        {children}
      </Columns>
      {hostTarget ? createPortal(column, hostTarget) : null}
    </SummaryColumnTarget>
  );
}

/** Not laid out: the wrappers stay in the tree, drawing nothing. */
const UNLAID = { display: "contents" } as const;

/**
 * The step, and beside it on a computer the column: the steps at most ~680px,
 * the column ~360px and sticky. On a phone or beside the host's own columns
 * the same two wrappers are kept, unlaid, so the step never changes place.
 */
function Columns({ sideBySide, column, children }: { sideBySide: boolean; column: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <Box
      data-testid={sideBySide ? "list-columns" : undefined}
      sx={sideBySide ? { display: "flex", gap: 4, alignItems: "flex-start", justifyContent: "center", width: "100%" } : UNLAID}
    >
      <Box sx={sideBySide ? { flex: 1, minWidth: 0, maxWidth: (t) => t.spacing(STEPS_MAX) } : UNLAID}>{children}</Box>
      {sideBySide ? (
        <Box sx={{ flex: "none", width: (t) => t.spacing(COLUMN_WIDTH), position: "sticky", top: (t) => t.spacing(3) }}>{column}</Box>
      ) : null}
    </Box>
  );
}
