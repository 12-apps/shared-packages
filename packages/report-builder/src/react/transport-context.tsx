import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";

import { httpTransport, type ReportBuilderTransport } from "./transport";

/**
 * The transport and tenant every screen in this package reads from.
 *
 * Context rather than props because the surface is ROUTED: a screen is
 * rendered by the router, not by a parent that could thread arguments to it.
 * Threading them would mean every page taking two props it does not use and
 * passing them down, which is the prop-drilling that context exists to avoid.
 */
interface ReportBuilderContextValue {
  transport: ReportBuilderTransport;
  tenantSlug: string;
}

const ReportBuilderContext = createContext<ReportBuilderContextValue | null>(null);

export function TransportProvider({
  transport,
  tenantSlug,
  children,
}: {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo(() => ({ transport, tenantSlug }), [transport, tenantSlug]);
  return <ReportBuilderContext.Provider value={value}>{children}</ReportBuilderContext.Provider>;
}

/**
 * The transport in scope.
 *
 * Falls back to same-origin `fetch` rather than throwing when no provider is
 * present: a host that mounts a page component directly — which is how every
 * consumer worked before `createWebReportBuilder` — must keep working unchanged.
 * Throwing here would turn this refactor into a breaking release.
 */
export function useTransport(): ReportBuilderTransport {
  const value = useContext(ReportBuilderContext);
  const fallback = useMemo(() => httpTransport(), []);
  return value?.transport ?? fallback;
}
