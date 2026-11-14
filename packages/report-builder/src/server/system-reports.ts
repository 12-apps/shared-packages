import type { ReportSpecInput, TimeGrain } from '../index';

import type { ReportWindow } from './adapter-shared';
import type { ReportActor } from './context';
import type { ReportRangePreset } from './range';

/**
 * BUILT-IN ("system") REPORTS — the SHAPE, which is this package's, over
 * CONTENT, which is never this package's.
 *
 * A built-in is a fixed view OF one of the host's admin areas: sales over time,
 * stock movements, whatever that host's product happens to be. The pipeline it
 * runs on is this package's — spec, catalog, window, permission narrowing,
 * rendering, the hub card and the deep link — and the query is the host's,
 * because only the host has entities to query.
 *
 * This module used to ship seven of them (`presets.ts`, `presets-kitchen.ts`):
 * the origin host's revenue, product ranking, payment-method donut, peak hours,
 * stock ledger, losses and its kitchen dashboard, in pt-BR, over entities named
 * `orders` and `kitchen_ticket_items`, gated by ids from that application's
 * catalog. They were the DEFAULT, so a host that named none served all seven —
 * over its own catalog, where they did not compile. The definitions moved to
 * the host; the types, the nav projection and the lookups stayed.
 */

export interface SystemReportDef {
  /** Stable key: the URL segment, the deep link, the nav testid. */
  key: string;
  title: string;
  description: string;
  /**
   * The permission required to run and to SEE it — one of the HOST's ids, from
   * the same catalog `entityPermission` names. Not a union here: this package
   * has no business enumerating another application's permissions, and the
   * three it used to enumerate (`reports:sales:read`, `stock:read`,
   * `reports:kitchen:read`) were exactly that.
   */
  permission: string;
  /**
   * The host nav section this report is nested under — a key of the host's own
   * menu, matched against {@link SystemReportSection}. Built-ins are fixed
   * views OF an area, so they live WITH that area rather than in a hub the
   * reader has to remember to visit.
   */
  section: string;
  /** Whether the date-grain toggle (day/week/month) applies. */
  supportsGrain: boolean;
  /**
   * The grains the toggle offers, in order (FUT-4063). Absent: all three. A
   * report whose rows are days and weeks says `['day', 'week']`, and the
   * toggle draws two options rather than a third that means nothing there.
   */
  grains?: readonly TimeGrain[];
  /** The grain toggle's name (FUT-4063), e.g. "Agrupar por"; absent = the surface's own word. */
  grainLabel?: string;
  /**
   * The periods the control offers, in order (FUT-4063), e.g. `['week', '7d',
   * 'month', '30d']`. Absent: the rolling four. The first is the default when
   * `30d` is not among them. Never `custom`.
   */
  ranges?: readonly Exclude<ReportRangePreset, 'custom'>[];
  /** Presentation kind surfaced on the hub card. */
  presentation: 'chart' | 'table';
  /**
   * What this run needs from the host beyond the catalog (FUT-4063), resolved
   * ONCE per run, on the server, before `build`:
   *
   *  - `params`: per-tenant numbers the spec is built with — a store's own
   *    target, which a flag's `above` and a heat map's `target` then carry as
   *    literals. The spec stays plain data.
   *  - `notes`: what the report says ABOUT its data that is not a row of it — a
   *    shift the system closed, a person with no rate. From the host's own
   *    reads, so nothing per person has to become a catalog dimension.
   *
   * Absent: no params, no notes.
   */
  derive?: (context: SystemReportRunContext) => Promise<SystemReportDerived>;
  /**
   * The spec for one run. `params` is what `derive` returned, or `{}` — which
   * is also what assembly validation passes, so a build must default a missing
   * param rather than assume it.
   */
  build: (options: SystemReportBuildOptions) => ReportSpecInput;
}

/** What `build` is handed. */
export interface SystemReportBuildOptions {
  grain: TimeGrain;
  params: SystemReportParams;
  /** The reader's language (BCP-47), when the host negotiated one (FUT-4063). */
  locale?: string;
}

/** Per-tenant numbers a built-in's spec is built with (FUT-4063). */
export type SystemReportParams = Readonly<Record<string, number>>;

/** What `derive` is handed: who asks, over which window, at which grain. */
export interface SystemReportRunContext {
  actor: ReportActor;
  window: ReportWindow;
  grain: TimeGrain;
  /** The reader's language (BCP-47), so notes and labels follow it (FUT-4063). */
  locale?: string;
}

/** What `derive` answers. */
export interface SystemReportDerived {
  params?: SystemReportParams;
  notes?: readonly ReportNote[];
}

/**
 * One thing a report says about its own data (FUT-4063), in the host's words.
 *
 * `text` may hold `{items}`, which the surface replaces with the first three
 * `items` and then "e mais N" — a list never grows the screen past three
 * names. A note whose `items` is EMPTY is not drawn: "nothing to say" hides,
 * it does not print a sentence about zero things.
 *
 * `figure` makes the note the HINT of that KPI figure (its index) instead of a
 * line under the block — "meta 30% · 2 dias acima" under "Custo / vendas".
 *
 * `action` is the one thing the note asks for, drawn as an outline button
 * under it; `href` is relative to the tenant root, the same rule as a
 * section's back-link path.
 */
export interface ReportNote {
  key: string;
  text: string;
  items?: readonly string[];
  figure?: number;
  action?: { label: string; href: string };
  /** On the phone, draw the note BELOW its block's card rather than inside it (FUT-4063). */
  phone?: 'below';
}

/**
 * A host menu section a built-in can belong to, as this surface needs it: the
 * key its reports name, the words the back-link reads, and where that link
 * goes.
 *
 * The label and the path are declared rather than derived. They used to be
 * derived — a hardcoded `{ orders: 'Pedidos', inventory: 'Estoque', kitchen:
 * 'Cozinha' }` map, plus the assumption that a section key IS the host's URL
 * segment (`/{tenantSlug}/{section}`). Both are facts about one host's menu:
 * the labels are that host's product vocabulary in its language, and the path
 * assumption breaks for any host whose stock area is not mounted at `/stock`.
 */
export interface SystemReportSection {
  /** Matches `SystemReportDef.section`. */
  key: string;
  /** What the back-link reads, in the host's own words and language. */
  label: string;
  /**
   * Where the back-link goes, relative to the tenant root and without a leading
   * slash (`'orders'`, `'stock/movements'`). The surface prefixes the tenant.
   */
  path: string;
}

export interface SystemDashboardBlockDef {
  /** The {@link SystemReportDef.key} this block renders. */
  reportKey: string;
  /** Width on the 12-column canvas; at or above the presentation's floor. */
  span: number;
  /**
   * `false` draws the block BARE (FUT-4063): no titled card and no tools — a
   * row of KPI tiles that are cards of their own. Default `true`.
   */
  frame?: boolean;
}

export interface SystemDashboardDef {
  key: string;
  title: string;
  description: string;
  /**
   * The single tier gating the whole canvas. Every member report should carry
   * the SAME permission: a mixed-tier dashboard renders a partly-empty canvas
   * that reads as "no sales" rather than as a missing grant.
   */
  permission: string;
  section: string;
  /** As on {@link SystemReportDef}: the grain toggle's name and the periods offered (FUT-4063). */
  grainLabel?: string;
  ranges?: readonly Exclude<ReportRangePreset, 'custom'>[];
  /**
   * Canvas-level disclosures rendered above the blocks: the facts a reader
   * needs in order to read ANY figure on the page — what is excluded from the
   * data, and when a figure is withheld rather than absent.
   */
  notes?: readonly string[];
  blocks: readonly SystemDashboardBlockDef[];
}

/** One built-in report as a host's lateral menu needs it. */
export interface SystemReportNavEntry {
  key: string;
  title: string;
  description: string;
  /** The READ permission gating the entry — identical to the API's own gate. */
  permission: string;
  section: string;
  /**
   * Whether the date-grain toggle applies. Carried on the nav entry so a
   * surface composing several reports can decide whether to OFFER the toggle
   * before any of them has loaded.
   */
  supportsGrain: boolean;
  /** The grains it offers (FUT-4063); absent means all three. */
  grains?: readonly TimeGrain[];
  grainLabel?: string;
  ranges?: readonly Exclude<ReportRangePreset, 'custom'>[];
}

/**
 * The built-ins as MENU entries, in declaration order.
 *
 * The host nests each under the nav item matching its `section` and gates it on
 * `permission`; the server re-checks that permission on every run, so the menu
 * can only ever hide a report the API would have refused — never grant one.
 */
export function systemReportNav(
  reports: readonly SystemReportDef[],
): readonly SystemReportNavEntry[] {
  return reports.map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    permission: report.permission,
    section: report.section,
    supportsGrain: report.supportsGrain,
    ...(report.grains ? { grains: report.grains } : {}),
    ...(report.grainLabel ? { grainLabel: report.grainLabel } : {}),
    ...(report.ranges ? { ranges: report.ranges } : {}),
  }));
}

/** Look up one built-in by key. */
export function findSystemReport(
  reports: readonly SystemReportDef[],
  key: string,
): SystemReportDef | undefined {
  return reports.find((report) => report.key === key);
}

/** Look up one dashboard by key. */
export function findSystemDashboard(
  dashboards: readonly SystemDashboardDef[],
  key: string,
): SystemDashboardDef | undefined {
  return dashboards.find((dashboard) => dashboard.key === key);
}
