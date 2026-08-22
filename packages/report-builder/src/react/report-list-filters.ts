import type { ReportListCopy, ReportRelativeTimeCopy } from "./screens-copy";
import type { SavedReportSummary } from "./custom-reports-api";

/**
 * Scope + search over the saved-report list (FUT-391, FUT-755).
 *
 * "Mostrar arquivados" was a floating checkbox, which made archiving read as a
 * display toggle rather than as one of the list's states. It becomes a SCOPE,
 * alongside search, so the two ways of narrowing the list sit together.
 *
 * Three scopes, matching `prototype.html`'s `renderList()`: `Todos` is
 * everything not archived, `Meus` is that narrowed to what YOU wrote, and
 * `Arquivados` is the archive. `Meus` used to be impossible here — the wire
 * summary carried no owner — and it is the server's `ownedByMe` that made it a
 * filter rather than a guess.
 */

export type ReportScope = "active" | "mine" | "archived";

/**
 * The pill labels, from the host's own words.
 *
 * A function rather than the constant it replaces: the labels are copy now,
 * and a module-scope constant cannot read config.
 */
export function reportScopeLabels(
  copy: ReportListCopy,
): Record<ReportScope, string> {
  return {
    active: copy.scopes.active ?? "",
    mine: copy.scopes.mine ?? "",
    archived: copy.scopes.archived ?? "",
  };
}

/** Pill order, left to right — the prototype's `Todos / Meus / Arquivados`. */
export const REPORT_SCOPES: readonly ReportScope[] = ["active", "mine", "archived"];

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
  if (scope === "archived") return report.status === "archived";
  // `Meus` is a narrowing of `Todos`, not a third bucket beside it: an archived
  // report of yours belongs to the archive, the way the prototype has it.
  if (scope === "mine") return report.status !== "archived" && report.ownedByMe;
  return report.status !== "archived";
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
 * There is no "keep this one anyway" escape hatch: opening a report navigates
 * to its own page (FUT-755), so the grid never has a current report that a
 * filter could pull out from under the reader.
 */
export function filterReports(
  reports: readonly SavedReportSummary[],
  { scope, search }: { scope: ReportScope; search: string },
): SavedReportSummary[] {
  return reports
    .filter((report) => matchesScope(report, scope) && matchesSearch(report, search))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * "3 blocos" / "1 bloco" — the plural the card's footer opens with.
 *
 * The whole string comes from the host, not a count spliced into a template:
 * agreement is the translator's rule, not this package's.
 */
export function blockCountLabel(count: number, copy: ReportListCopy): string {
  return copy.blockCount(count);
}

/** Who can read it, in the card footer's words. */
export function visibilityLabel(
  visibility: SavedReportSummary["visibility"],
  copy: ReportListCopy,
): string {
  return copy.visibility[visibility] ?? "";
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * "há 2 min", "ontem", "há 3 dias", "há 1 semana" — the card's last-edited line.
 *
 * A pure function taking BOTH instants rather than reading the clock itself:
 * a relative time is exactly the kind of thing that silently drifts (an
 * off-by-one at the day boundary reads as "ontem" all afternoon), and a
 * function that calls `Date.now()` internally can only be tested by stubbing a
 * global — which is what the flakiness gate exists to stop.
 *
 * The steps come from `prototype.html`'s own card footers: minutes, then hours,
 * then a named "ontem", then days, then weeks. Anything older than a week is
 * still counted in weeks rather than switching to a date, because the question
 * the footer answers is "is this stale?", not "which Tuesday was it?".
 */
export function relativeReportTime(
  updatedAt: string,
  now: Date,
  copy: ReportRelativeTimeCopy,
): string {
  const then = Date.parse(updatedAt);
  // An unparseable timestamp is not "just now": say nothing rather than
  // inventing a freshness the row does not have.
  if (Number.isNaN(then)) return "";
  const elapsed = now.getTime() - then;
  // A clock skewed the other way (a server ahead of the browser) is still
  // "now", not a negative age counted in weeks.
  // The STEPS stay here — minutes, hours, a named yesterday, days, weeks — and
  // only the words leave. Where a language breaks the scale is a product
  // decision about staleness; how it says each step is the translator's.
  if (elapsed < MINUTE_MS) return copy.now;
  if (elapsed < HOUR_MS) return copy.minutes(Math.floor(elapsed / MINUTE_MS));
  if (elapsed < DAY_MS) return copy.hours(Math.floor(elapsed / HOUR_MS));
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return copy.yesterday;
  if (elapsed < WEEK_MS) return copy.days(days);
  return copy.weeks(Math.floor(elapsed / WEEK_MS));
}
