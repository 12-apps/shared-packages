import type { SavedReportSummary } from "./custom-reports-api";

/**
 * Scope + search over the saved-report list (FUT-391).
 *
 * "Mostrar arquivados" was a floating checkbox, which made archiving read as a
 * display toggle rather than as one of the list's states. It becomes a SCOPE,
 * alongside search, so the two ways of narrowing the list sit together.
 *
 * `Meus` is deliberately absent: `SavedReportSummary` carries no owner, so a
 * "mine" scope would have to guess. Adding it means adding an owner to the
 * wire type first — a server change, not a filter.
 */

export type ReportScope = "active" | "archived";

export const REPORT_SCOPE_LABELS: Record<ReportScope, string> = {
  active: "Todos",
  archived: "Arquivados",
};

/**
 * Case- and accent-insensitive, because the names are Portuguese: someone
 * looking for "Relatório de vendas" should find it by typing "relatorio".
 */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function matchesScope(report: SavedReportSummary, scope: ReportScope): boolean {
  return scope === "archived" ? report.status === "archived" : report.status !== "archived";
}

function matchesSearch(report: SavedReportSummary, needle: string): boolean {
  if (needle === "") return true;
  const term = normalize(needle);
  // Description too: a report named "Vendas" and one named "Vendas 2" are told
  // apart by their descriptions, so searching only names hides the difference.
  return (
    normalize(report.name).includes(term) ||
    normalize(report.description ?? "").includes(term)
  );
}

/**
 * The reports a scope + search should show, newest edit first.
 *
 * `keepId` survives both filters — a report reached by deep link must not
 * vanish because it happens to be archived or not to match the current search.
 * The URL is a stronger statement of intent than the filter row.
 */
export function filterReports(
  reports: readonly SavedReportSummary[],
  { scope, search, keepId }: { scope: ReportScope; search: string; keepId?: string },
): SavedReportSummary[] {
  return reports
    .filter(
      (report) =>
        report.id === keepId || (matchesScope(report, scope) && matchesSearch(report, search)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** How many reports each scope holds, for the pill counts. */
export function scopeCounts(
  reports: readonly SavedReportSummary[],
): Record<ReportScope, number> {
  return {
    active: reports.filter((report) => matchesScope(report, "active")).length,
    archived: reports.filter((report) => matchesScope(report, "archived")).length,
  };
}
