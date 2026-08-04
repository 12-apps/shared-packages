import type {
  SystemDashboardDef,
  SystemReportDef,
  SystemReportPermission,
  SystemReportSection,
} from "./preset-types";
import { KITCHEN_SYSTEM_DASHBOARD, KITCHEN_SYSTEM_REPORTS } from "./presets-kitchen";

export type { SystemDashboardDef, SystemReportSection } from "./preset-types";

/**
 * Built-in ("system") reports (FUT-133): hardcoded, non-editable spec presets
 * over the SAME engine custom reports use — deliberately avoiding Squire's
 * built-ins-share-nothing split. Each preset is just a ReportSpec builder;
 * execution, permissions and rendering flow through the shared pipeline.
 *
 * Prisma-free: imported by the MCP registry (offline generation) and by unit
 * tests that compile every preset against the catalog.
 */

const PAID_ORDERS = { field: "status", operator: "eq", value: "PAID" } as const;

export const SYSTEM_REPORTS: readonly SystemReportDef[] = [
  {
    key: "vendas-resumo",
    title: "Vendas — resumo",
    description: "Receita de pedidos pagos ao longo do período.",
    permission: "reports:sales:read",
    section: "orders",
    supportsGrain: true,
    presentation: "chart",
    build: ({ grain }) => ({
      entity: "orders",
      dimensions: [{ field: "createdAt", timeGrain: grain }],
      measures: [{ field: "revenueCents", aggregation: "sum", alias: "receita" }],
      filters: [PAID_ORDERS],
      sort: [{ by: `createdAt_${grain}`, direction: "asc" }],
      presentation: { kind: "chart", chartType: "area" },
    }),
  },
  {
    key: "vendas-por-produto",
    title: "Vendas por produto",
    description: "Ranking de produtos por receita, quantidade e custo (CMV).",
    permission: "reports:sales:read",
    section: "orders",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "order_items",
      dimensions: [{ field: "productName" }],
      measures: [
        { field: "quantity", aggregation: "sum", alias: "quantidade" },
        { field: "revenueCents", aggregation: "sum", alias: "receita" },
        { field: "costCents", aggregation: "sum", alias: "custo" },
      ],
      sort: [{ by: "receita", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "vendas-por-categoria",
    title: "Vendas por categoria",
    description: "Receita e quantidade vendida por categoria de produto.",
    permission: "reports:sales:read",
    section: "orders",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "order_items",
      dimensions: [{ field: "categoryName" }],
      measures: [
        { field: "quantity", aggregation: "sum", alias: "quantidade" },
        { field: "revenueCents", aggregation: "sum", alias: "receita" },
      ],
      sort: [{ by: "receita", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "formas-de-pagamento",
    title: "Formas de pagamento",
    description: "Receita liquidada por forma de pagamento (PIX, cartão…).",
    permission: "reports:sales:read",
    section: "orders",
    supportsGrain: false,
    presentation: "chart",
    build: () => ({
      entity: "payments",
      dimensions: [{ field: "method" }],
      measures: [{ field: "amountCents", aggregation: "sum", alias: "valor" }],
      filters: [{ field: "status", operator: "eq", value: "PAID" }],
      sort: [{ by: "valor", direction: "desc" }],
      presentation: { kind: "chart", chartType: "donut" },
    }),
  },
  {
    key: "vendas-por-horario",
    title: "Vendas por horário",
    description: "Receita por hora local (America/Sao_Paulo) — horários de pico.",
    permission: "reports:sales:read",
    section: "orders",
    supportsGrain: false,
    presentation: "chart",
    build: () => ({
      entity: "orders",
      dimensions: [{ field: "hourOfDay" }],
      measures: [{ field: "revenueCents", aggregation: "sum", alias: "receita" }],
      filters: [PAID_ORDERS],
      sort: [{ by: "hourOfDay", direction: "asc" }],
      presentation: { kind: "chart", chartType: "bar" },
    }),
  },
  {
    key: "estoque-movimentos",
    title: "Estoque — movimentações",
    description: "Movimentações de estoque por período e tipo (compra, produção, ajuste…).",
    permission: "stock:read",
    section: "inventory",
    supportsGrain: true,
    presentation: "table",
    build: ({ grain }) => ({
      entity: "stock_movements",
      dimensions: [{ field: "createdAt", timeGrain: grain }, { field: "type" }],
      measures: [
        { field: "quantityDelta", aggregation: "sum", alias: "quantidade" },
        { field: "costCents", aggregation: "sum", alias: "custo" },
      ],
      sort: [{ by: `createdAt_${grain}`, direction: "asc" }],
      limit: 500,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "perdas",
    title: "Perdas",
    description: "Valor perdido por motivo, a custo da época do registro.",
    permission: "stock:read",
    section: "inventory",
    supportsGrain: false,
    presentation: "chart",
    build: () => ({
      entity: "loss_events",
      dimensions: [{ field: "reasonName" }],
      measures: [{ field: "lossValueCents", aggregation: "sum", alias: "valor" }],
      sort: [{ by: "valor", direction: "desc" }],
      presentation: { kind: "chart", chartType: "bar" },
    }),
  },
  ...KITCHEN_SYSTEM_REPORTS,
];

export const SYSTEM_REPORT_KEYS = SYSTEM_REPORTS.map((report) => report.key) as [
  string,
  ...string[],
];

export function getSystemReport(key: string): SystemReportDef | undefined {
  return SYSTEM_REPORTS.find((report) => report.key === key);
}

/** One built-in report as the host's lateral menu needs it (FUT-391). */
export interface SystemReportNavEntry {
  key: string;
  title: string;
  description: string;
  /** The READ permission gating the entry — identical to the API's own gate. */
  permission: SystemReportPermission;
  section: SystemReportSection;
  /**
   * Whether the date-grain toggle applies. Carried on the nav entry so a
   * surface composing several reports can decide whether to OFFER the toggle
   * before any of them has loaded.
   */
  supportsGrain: boolean;
}

/**
 * The built-in reports as MENU entries, in catalog order. The host nests each
 * under the nav item matching its `section` and gates it on `permission`; the
 * server re-checks that permission on every run, so the menu can only ever
 * hide a report the API would have refused — never grant one.
 */
export const SYSTEM_REPORT_NAV: readonly SystemReportNavEntry[] = SYSTEM_REPORTS.map(
  (report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    permission: report.permission,
    section: report.section,
    supportsGrain: report.supportsGrain,
  }),
);

/**
 * A CONSOLIDATED section dashboard: the built-in reports of one admin area laid
 * out on a single canvas, under a single period selector.
 *
 * Five sibling menu rows under Pedidos — resumo, por produto, por categoria,
 * formas de pagamento, por horário — are not five questions an operator asks
 * one at a time; they are five angles on the SAME question ("how did we
 * sell?"). Read one page at a time they could not be compared, because each
 * screen carried its own period selector: "a receita caiu" on one and "PIX
 * dominou" on another might be describing different windows. One canvas, one
 * selector, and the comparison stops being something the operator holds in
 * their head.
 *
 * A dashboard COMPOSES presets rather than restating their specs: each block
 * names a {@link SYSTEM_REPORTS} key, so a preset's query is authored once and
 * the canvas inherits every later fix to it. `span` is the block's width on the
 * shared 12-column report grid (see `../layout`).
 */
/**
 * The built-in dashboards, mounted in the host's lateral menu under the nav
 * item matching `section` — the same contract {@link SYSTEM_REPORT_NAV}
 * follows, and gated the same way (the server re-checks the permission on
 * every report run, so the menu can only hide, never grant).
 *
 * Block order is the reading order of the canvas, and the spans make each row
 * answer one thing: the revenue trend full width, because it is the headline
 * and the only block the grain toggle moves; peak hours (8) beside payment
 * methods (4) — "when" and "how", and a donut reads fine at a third of the
 * canvas; then produtos (6) beside categorias (6), the same ranking at two zoom
 * levels, so "which category carried this product" is one glance instead of one
 * navigation.
 */
export const SYSTEM_DASHBOARDS: readonly SystemDashboardDef[] = [
  {
    key: "vendas",
    title: "Vendas — painel",
    description:
      "Todos os relatórios de vendas da loja no mesmo período: receita, horários de pico, formas de pagamento e os rankings por produto e categoria.",
    permission: "reports:sales:read",
    section: "orders",
    blocks: [
      { reportKey: "vendas-resumo", span: 12 },
      { reportKey: "vendas-por-horario", span: 8 },
      { reportKey: "formas-de-pagamento", span: 4 },
      { reportKey: "vendas-por-produto", span: 6 },
      { reportKey: "vendas-por-categoria", span: 6 },
    ],
  },
  KITCHEN_SYSTEM_DASHBOARD,
];

export function getSystemDashboard(key: string): SystemDashboardDef | undefined {
  return SYSTEM_DASHBOARDS.find((dashboard) => dashboard.key === key);
}
