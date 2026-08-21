import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";

import type { ReportEngineCopy } from "../copy";

import type { ReportBuilderCopy } from "./copy";
import type {
  SystemDashboardDef,
  SystemReportNavEntry,
  SystemReportSection,
} from "../server/system-reports";

import type { BlockTemplateGroup } from "../server/block-templates";
import { httpTransport, type ReportBuilderTransport } from "./transport";

/**
 * What every screen in this package reads from: how to reach the API, whose
 * reports these are, and the HOST's vocabulary for the surface.
 *
 * Context rather than props because the surface is ROUTED: a screen is
 * rendered by the router, not by a parent that could thread arguments to it.
 * Threading them would mean every page taking props it does not use and passing
 * them down, which is the prop-drilling that context exists to avoid.
 *
 * The vocabulary half is new, and it is what stopped this package shipping
 * another application's product inside it. `system-report`, `system-dashboard`
 * and `reports-page` used to import the origin host's `SYSTEM_REPORT_NAV`,
 * `SYSTEM_DASHBOARDS` and `SYSTEM_REPORT_KEYS` at module scope, and the editor
 * canvas imported that host's block templates the same way — so a host that
 * mounted this surface got that store's built-ins, its dashboards, its pt-BR
 * section labels and its template picker whether it wanted them or not, with no
 * config field to say otherwise.
 */
export interface ReportBuilderSurface {
  /** The host's built-in reports, as nav/lookup entries. `[]` for none. */
  systemReports: readonly SystemReportNavEntry[];
  /** The host's consolidated dashboards. `[]` for none. */
  systemDashboards: readonly SystemDashboardDef[];
  /** Where a built-in's back-link goes, and what it reads. */
  sections: readonly SystemReportSection[];
  /** The "Adicionar bloco" picker's host-authored groups. */
  blockTemplates: readonly BlockTemplateGroup[];
  /** The tenant's IANA zone — the clock the period picker calls "hoje". */
  timeZone: string;
}

/**
 * What a screen sees when it is mounted OUTSIDE the surface provider.
 *
 * Empty, and `UTC` — the "nothing was declared" answer, not a stand-in for one.
 * A default here can only be wrong for somebody: a list of built-ins would be
 * some other product's menu, and a zone would be some other store's day. Empty
 * renders a surface with no built-ins and a blank-only block picker, which is
 * exactly what "no host told us" should look like.
 */
const EMPTY_SURFACE: ReportBuilderSurface = {
  systemReports: [],
  systemDashboards: [],
  sections: [],
  blockTemplates: [],
  timeZone: "UTC",
};

interface ReportBuilderContextValue {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  surface: ReportBuilderSurface;
  copy: ReportBuilderCopy;
}

const ReportBuilderContext = createContext<ReportBuilderContextValue | null>(null);

export function ReportBuilderProvider({
  transport,
  tenantSlug,
  surface,
  copy,
  children,
}: {
  transport: ReportBuilderTransport;
  tenantSlug: string;
  surface: ReportBuilderSurface;
  copy: ReportBuilderCopy;
  children: ReactNode;
}): JSX.Element {
  const value = useMemo(
    () => ({ transport, tenantSlug, surface, copy }),
    [transport, tenantSlug, surface, copy],
  );
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

/** The host's vocabulary in scope; empty outside a provider. */
export function useReportSurface(): ReportBuilderSurface {
  return useContext(ReportBuilderContext)?.surface ?? EMPTY_SURFACE;
}

/**
 * The engine copy in scope — the spec sentence's words, the column headings,
 * the reasons a presentation is unavailable, and what a boolean cell reads as.
 *
 * THROWS outside a provider, unlike {@link useTransport} and
 * {@link useReportSurface}, which fall back. Those two have a meaningful empty
 * answer — same-origin fetch, and a surface with no built-ins. Copy does not:
 * a screen with no words is broken, and a default here would be the origin
 * host's Portuguese, which is the exact thing this config exists to stop being
 * silent. Failing at the first render names the wiring mistake; blank labels
 * would hide it.
 */
export function useReportCopy(): ReportBuilderCopy {
  const value = useContext(ReportBuilderContext);
  if (!value) {
    throw new Error(
      "Report screens must be mounted inside <ReportBuilderProvider>, which supplies `copy`. " +
        "Mount the surface with createWebReportBuilder({ copy, ... }).",
    );
  }
  return value.copy;
}

/** The engine half of the copy in scope — the shorthand most screens want. */
export function useReportEngineCopy(): ReportEngineCopy {
  return useReportCopy().engine;
}
