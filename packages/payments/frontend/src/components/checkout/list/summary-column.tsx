import { Box } from "@mui/material";
import { Suspense, createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { CheckoutSummaryLine } from "../payment-summary";
import { useCheckoutLayout } from "../payment-step-layout";

import { deferredPart } from "./lazy-body";
import type { ColumnProps } from "./summary-column-body";

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

const useSummaryColumnBody = deferredPart(async () => ({ default: (await import("./summary-column-body")).SummaryColumn }));

/**
 * The column's action slot alone, while the column's chunk loads (FUT-3711):
 * the bar's content — the pay button with it — is portalled in here at once,
 * so the action never waits on the summary above it. The column drawn in
 * full takes the slot over when it lands.
 */
function ColumnWhileLoading({ slot }: { slot: (element: HTMLElement | null) => void }): JSX.Element {
  return <Box ref={slot} data-testid="list-summary-action" data-loading="true" sx={{ display: "flex", flexDirection: "column" }} />;
}

/**
 * "Resumo do pedido" (T20), loaded as a chunk of its own (FUT-3711): a phone
 * never draws it, so a phone never parses it.
 */
function SummaryColumn(props: ColumnProps): JSX.Element {
  const Body = useSummaryColumnBody();
  return (
    <Suspense fallback={<ColumnWhileLoading slot={props.slot} />}>
      <Body {...props} />
    </Suspense>
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
  credit?: ColumnProps["credit"];
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
