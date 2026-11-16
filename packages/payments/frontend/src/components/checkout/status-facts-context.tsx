import { createContext, useContext, type JSX, type ReactNode } from "react";

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

const StatusFactsReporterContext = createContext<StatusFactsReporter | null>(null);

export function StatusFactsReporterProvider({
  report,
  children,
}: {
  report: StatusFactsReporter;
  children: ReactNode;
}): JSX.Element {
  return <StatusFactsReporterContext.Provider value={report}>{children}</StatusFactsReporterContext.Provider>;
}

/** The flow's reporter, or null outside a flow. */
export function useStatusFactsReporter(): StatusFactsReporter | null {
  return useContext(StatusFactsReporterContext);
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
 * A card the server answered FAILED (FUT-612, contract C2 and C7 by card): a
 * capture can come back short, and a refusal beside the card form would then
 * tell somebody whose money arrived that nothing was charged. So inside a flow
 * the card path asks `/status` ONCE — only on FAILED — and answers whether the
 * server stated a money fact. When it did, the fact is reported to the flow and
 * the caller resolves to the confirmation step; when it did not (a real
 * decline), or nothing listens, or the read fails, the caller refuses exactly
 * as before.
 */
export async function moneyFactOnFailure(
  client: Pick<CheckoutClient, "getStatusDetail">,
  orderId: string,
  report: StatusFactsReporter | null,
): Promise<boolean> {
  if (!report || !client.getStatusDetail) return false;
  const answered = await client.getStatusDetail(orderId);
  if (!answered.ok || (!answered.data.shortfall && !answered.data.stockGone)) return false;
  report(orderId, answered.data);
  return true;
}
