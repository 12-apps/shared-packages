import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type JSX } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ReportEditorPage } from "./report-editor";
import { ReportsPage } from "./reports-page";
import { SystemDashboardPage } from "./system-dashboard";
import { SystemReportPage } from "./system-report";
import { TransportProvider } from "./transport-context";
import { httpTransport, type ReportBuilderTransport } from "./transport";

/**
 * The one thing this package exposes to a frontend host (FUT-391).
 *
 * Before this, a host wired the reports surface by importing four page
 * components and hand-writing the routes between them — so the ROUTING was
 * host code, and every host had to rediscover that `reports/new` must precede
 * `reports/:id` or the static segment is read as an id. That is a rule of this
 * surface, not of the host, and it belongs here with the screens it governs.
 *
 * A host now writes one line. Everything the reports feature is — screens,
 * flows, cards, the editor, the routes between them — lives inside the
 * package, and the host supplies only what is genuinely its own: which tenant,
 * and how to reach the API.
 */
export interface ReportBuilderConfig {
  /** Whose reports these are. Threaded to every screen and query key. */
  tenantSlug: string;
  /**
   * How to reach the backend. Omit for same-origin `fetch`, which is what a
   * real host wants; supply one to mount the surface against something else —
   * an in-memory backend in a harness, or a host's own authenticated client.
   */
  transport?: ReportBuilderTransport;
  /**
   * Provide when the host already renders a `<QueryClientProvider>` and a
   * router. Then the surface mounts INTO them — sharing the host's cache, so
   * an invalidation elsewhere in the app refreshes reports — rather than
   * standing up its own, which would silently give it a second cache.
   */
  standalone?: boolean;
  /** Initial route when standalone. Ignored when mounting into a host router. */
  initialPath?: string;
}

/** The routed surface: every reports screen and the paths between them. */
function ReportBuilderRoutes({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  return (
    <Routes>
      {/* Order is load-bearing: `new` and the system paths carry static
       * segments that `:reportId` / `:reportKey` would otherwise swallow. This
       * is the rule hosts kept having to rediscover. */}
      <Route path="/" element={<ReportsPage tenantSlug={tenantSlug} />} />
      <Route path="/new" element={<ReportEditorPage tenantSlug={tenantSlug} />} />
      <Route
        path="/system/dashboards/:dashboardKey"
        element={<SystemDashboardPage tenantSlug={tenantSlug} />}
      />
      <Route path="/system/:reportKey" element={<SystemReportPage tenantSlug={tenantSlug} />} />
      <Route path="/:reportId" element={<ReportsPage tenantSlug={tenantSlug} />} />
      <Route path="/:reportId/edit" element={<ReportEditorPage tenantSlug={tenantSlug} />} />
    </Routes>
  );
}

/**
 * Build the reports surface for a host.
 *
 * Returns a single component. A host mounts it and is done — there is no
 * second export to wire, and no route table to copy.
 */
export function createReportBuilder(config: ReportBuilderConfig): {
  ReportBuilder: () => JSX.Element;
} {
  const { tenantSlug, transport, standalone = false, initialPath = "/" } = config;

  function ReportBuilder(): JSX.Element {
    // One client per mount, not per render: a client rebuilt on each render
    // discards the cache every time, so every screen refetches on any state
    // change and the surface never settles.
    const client = useMemo(() => new QueryClient(), []);
    const resolved = useMemo(() => transport ?? httpTransport(), []);

    const surface = (
      <TransportProvider transport={resolved} tenantSlug={tenantSlug}>
        <ReportBuilderRoutes tenantSlug={tenantSlug} />
      </TransportProvider>
    );

    if (!standalone) return surface;

    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>{surface}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { ReportBuilder };
}
