import { createContext, useContext, useMemo, useRef, type JSX, type ReactNode } from "react";

import { ok, type Result } from "../../result";

import type { CheckoutStatusDetail } from "./status-detail";
import type { CheckoutClient } from "./transport";
import type { OrderStatus } from "./types";

/**
 * Where the money facts a `/status` answer carries go (FUT-612).
 *
 * Every wait in the flow — the Pix pane's poll, the card's 3-D Secure wait, the
 * confirmation screen's own — reads `/status` through `usePaymentPolling`, and
 * that hook answers a bare status to everything that consumes it. The facts
 * (`shortfall`, `stockGone`) ride the SAME answer, so the poll reports them
 * here on the side instead of widening every consumer: no second request, no
 * new argument through four components.
 *
 * `<CheckoutFlow>` provides the reporter. Anything mounted outside it — a
 * `flows.screens.*` screen on its own — reports to nobody, and polls exactly
 * as before.
 */
export type StatusFactsReporter = (orderId: string, detail: CheckoutStatusDetail) => void;

/** The reporter, and the last settled answer it was handed — read back by the card's poll path. */
interface StatusFactsChannel {
  report: StatusFactsReporter;
  /** The last settled detail reported for `orderId`, or null when none was. */
  known(orderId: string): CheckoutStatusDetail | null;
}

const StatusFactsReporterContext = createContext<StatusFactsChannel | null>(null);

export function StatusFactsReporterProvider({
  report,
  children,
}: {
  report: StatusFactsReporter;
  children: ReactNode;
}): JSX.Element {
  // A ref, not state: the card's poll path reads it in the same effect that
  // sees the poll's FAILED, which the facts reached first (`askStatus`).
  const last = useRef<{ orderId: string; detail: CheckoutStatusDetail } | null>(null);
  const channel = useMemo<StatusFactsChannel>(
    () => ({
      report: (orderId, detail) => {
        last.current = { orderId, detail };
        report(orderId, detail);
      },
      known: (orderId) => (last.current?.orderId === orderId ? last.current.detail : null),
    }),
    [report],
  );
  return <StatusFactsReporterContext.Provider value={channel}>{children}</StatusFactsReporterContext.Provider>;
}

/** The flow's reporter, or null outside a flow. */
export function useStatusFactsReporter(): StatusFactsReporter | null {
  return useContext(StatusFactsReporterContext)?.report ?? null;
}

/** What the flow's polls last reported for an order, or null (none reported, or outside a flow). */
export function useKnownStatusFacts(): ((orderId: string) => CheckoutStatusDetail | null) | null {
  return useContext(StatusFactsReporterContext)?.known ?? null;
}

/** Whether a settled answer states a money fact. */
export function statesMoneyFact(detail: CheckoutStatusDetail | null): boolean {
  return detail !== null && (detail.shortfall !== undefined || detail.stockGone !== undefined);
}

/**
 * One `/status` ask, answered as the bare status every poll consumer reads —
 * through `getStatusDetail` when the client has it and someone is listening, so
 * a settled answer's facts reach the flow from the very same request.
 */
export async function askStatus(
  client: Pick<CheckoutClient, "getStatus" | "getStatusDetail">,
  orderId: string,
  report: StatusFactsReporter | null,
): Promise<Result<OrderStatus>> {
  if (!report || !client.getStatusDetail) return client.getStatus(orderId);
  const answered = await client.getStatusDetail(orderId);
  if (!answered.ok) return answered;
  // A settled answer is reported even with no fact: it is what tells the flow
  // the facts of this order are KNOWN (a decline), so nothing asks again.
  if (answered.data.status !== "AWAITING_PAYMENT") report(orderId, answered.data);
  return ok(answered.data.status);
}

/**
 * How long the card's direct-FAILED path waits for its one `/status` read
 * before refusing as it always did: a hung `/status` must never leave the card
 * busy where today's screen refused at once.
 */
export const FAILURE_FACTS_TIMEOUT_MS = 4000;

/**
 * A card the server answered FAILED in the charge's OWN answer (FUT-612,
 * contract C2 and C7 by card): a capture can come back short, and a refusal
 * beside the card form would then tell somebody whose money arrived that
 * nothing was charged. So inside a flow this asks `/status` ONCE, within
 * {@link FAILURE_FACTS_TIMEOUT_MS}, and answers whether the server stated a
 * money fact. When it did, the fact is reported and the caller resolves to the
 * confirmation step; when it did not (a real decline), nothing listens, the
 * read fails or it runs out of time, the caller refuses exactly as before.
 *
 * The card's POLL path never calls this: its own read already went through
 * `getStatusDetail` and reported, so it reads {@link useKnownStatusFacts}.
 */
export async function moneyFactOnFailure(
  client: Pick<CheckoutClient, "getStatusDetail">,
  orderId: string,
  report: StatusFactsReporter | null,
  timeoutMs: number = FAILURE_FACTS_TIMEOUT_MS,
): Promise<boolean> {
  if (!report || !client.getStatusDetail) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const answered = await Promise.race([client.getStatusDetail(orderId), late]);
  clearTimeout(timer);
  if (!answered?.ok || !statesMoneyFact(answered.data)) return false;
  report(orderId, answered.data);
  return true;
}
