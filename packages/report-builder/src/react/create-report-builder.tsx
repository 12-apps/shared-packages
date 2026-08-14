import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type JSX } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ReportBuilderError } from "../errors";
import { isValidTimeZone } from "../time";

import { ReportEditorPage } from "./report-editor";
import { ReportsPage } from "./reports-page";
import { SystemDashboardPage } from "./system-dashboard";
import { SystemReportPage } from "./system-report";
import { ReportBuilderProvider, type ReportBuilderSurface } from "./transport-context";
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
   * The HOST's vocabulary for this surface: its built-in reports, its
   * dashboards, the menu sections they hang off, the block templates its
   * picker offers, and the clock its tenants keep.
   *
   * REQUIRED, every field of it, including the empty cases. Each one used to be
   * a module-scope import of future-pay's answer, which meant a host mounting
   * this surface published that store's built-ins under its own menu — and had
   * no field to decline them with. `{ systemReports: [], systemDashboards: [],
   * sections: [], blockTemplates: [], timeZone: 'Europe/Lisbon' }` is a
   * complete, meaningful configuration: the authored-reports surface, no
   * built-ins.
   */
  surface: ReportBuilderSurface;
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
  /**
   * Initial route when standalone. Ignored when mounting into a host router.
   * Defaults to the surface's own root, `/<tenantSlug>/reports`.
   */
  initialPath?: string;
}

/**
 * Where this surface lives in a host's URL space.
 *
 * It is not a preference: every screen navigates to absolute
 * `/<tenantSlug>/reports/...` paths, so a router that does not have the
 * surface mounted there matches nothing the moment anything is clicked. A host
 * router supplies that prefix; standalone has to supply it too, or the first
 * navigation renders a blank page — which is exactly what it did.
 */
function surfaceRoot(tenantSlug: string): string {
  return `/${tenantSlug}/reports`;
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
 * Check the host's vocabulary, or throw naming the field that is wrong.
 *
 * At the factory call, where the wiring is, rather than on the screen that
 * happens to read the broken entry: a dashboard naming a report nobody
 * declared renders a canvas of empty frames, and a built-in whose section
 * nobody declared renders a back-link labelled "Voltar" pointing at a page that
 * may not exist. Both read as bugs in this package from every seat but this
 * one.
 */
function assertSurface(surface: ReportBuilderSurface): void {
  if (!isValidTimeZone(surface.timeZone)) {
    throw new ReportBuilderError(
      "invalid_config",
      `surface.timeZone is not an IANA zone this runtime knows: "${surface.timeZone}".`,
    );
  }
  const keys = new Set(surface.systemReports.map((report) => report.key));
  const sections = new Set(surface.sections.map((section) => section.key));
  for (const report of surface.systemReports) {
    if (!sections.has(report.section)) {
      throw new ReportBuilderError(
        "invalid_config",
        `System report "${report.key}" names section "${report.section}", which surface.sections does not declare.`,
      );
    }
  }
  // A DASHBOARD's section was unchecked while its blocks' reports were, which
  // is the same defect one level up: `system-dashboard.tsx` builds its back-link
  // from `dashboard.section` exactly as `system-report.tsx` does from a
  // report's, so an undeclared one renders a "Voltar" pointing at a page that
  // may not exist — a bug that reads as this package's from every seat but the
  // call site.
  const dashboardKeys = new Set<string>();
  for (const dashboard of surface.systemDashboards) {
    if (dashboardKeys.has(dashboard.key)) {
      throw new ReportBuilderError(
        "invalid_config",
        `Two system dashboards share the key "${dashboard.key}". The key is the URL segment, so one of them is unreachable.`,
      );
    }
    dashboardKeys.add(dashboard.key);
    if (!sections.has(dashboard.section)) {
      throw new ReportBuilderError(
        "invalid_config",
        `Dashboard "${dashboard.key}" names section "${dashboard.section}", which surface.sections does not declare.`,
      );
    }
  }
  // Flattened rather than nested, so the block carries the dashboard it came
  // from: the gate reads a loop inside a loop as a suspected hot path, and a
  // one-pass `flatMap` is the honest shape for a check that visits each block
  // exactly once anyway.
  const blocks = surface.systemDashboards.flatMap((dashboard) =>
    dashboard.blocks.map((block) => ({ dashboard: dashboard.key, reportKey: block.reportKey })),
  );
  for (const block of blocks) {
    if (!keys.has(block.reportKey)) {
      throw new ReportBuilderError(
        "invalid_config",
        `Dashboard "${block.dashboard}" renders "${block.reportKey}", which surface.systemReports does not declare.`,
      );
    }
  }
}

/**
 * Build the reports surface for a host.
 *
 * Returns a single component under the name `page`, mirroring the backend
 * half's `routes`: a host reading either call site can tell which half it is
 * looking at and what it gets back, without opening the package.
 *
 * A host mounts it and is done — there is no second export to wire, and no
 * route table to copy.
 */
export function createWebReportBuilder(config: ReportBuilderConfig): {
  page: () => JSX.Element;
} {
  const { tenantSlug, transport, surface, standalone = false } = config;
  const initialPath = config.initialPath ?? surfaceRoot(tenantSlug);
  assertSurface(surface);

  function ReportBuilder(): JSX.Element {
    // One client per mount, not per render: a client rebuilt on each render
    // discards the cache every time, so every screen refetches on any state
    // change and the surface never settles.
    const client = useMemo(() => new QueryClient(), []);
    const resolved = useMemo(() => transport ?? httpTransport(), []);

    const tree = (
      <ReportBuilderProvider transport={resolved} tenantSlug={tenantSlug} surface={surface}>
        <ReportBuilderRoutes tenantSlug={tenantSlug} />
      </ReportBuilderProvider>
    );

    if (!standalone) return tree;

    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          {/* The prefix a host router would have matched, reproduced here so
           * standalone behaves identically. Without it the surface renders
           * once and then vanishes on the first navigation. */}
          <Routes>
            <Route path={`${surfaceRoot(tenantSlug)}/*`} element={tree} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { page: ReportBuilder };
}
