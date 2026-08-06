import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Chip } from "../Chip";
import { Breadcrumbs } from "../../navigation/Breadcrumbs";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";

import { BaseCard } from "./base-card";
import { DataViewsTableBase } from "./DataViewsTableBase";
import type { BoardConfig } from "./DataViewsBoard";
import type { DataViewExport } from "./data-views-export";
import type { ScopeConfig } from "./data-views-scopes";
import type {
  DataViewCardSelection,
  DataViewColumn,
  DataViewPersistence,
  DataViewRouter,
  FilterFieldConfig,
  RangeFieldConfig,
  RowAction,
  SavedViewSummary,
} from "./data-views-types";

/**
 * The Pedidos (orders) screen, assembled from a real export.
 *
 * This is the whole admin table in one component: the Select All / Sort By /
 * counter / saved-views toolbar, the filter row, column visibility, row kebabs
 * and bulk actions. In future-pay the same screen is
 * `apps/admin/src/pages/orders`, which wires `persistence`, `router` and the
 * fetch to its backend and react-router; here they are inert so the story stays
 * hermetic.
 *
 * Behaviour follows `docs/data-views/contract.md` and `filters.feature`, most
 * visibly in {@link ServerMode}: admin lists run in server mode, so the grid
 * renders exactly the page it was handed and the counter reports the server's
 * total rather than `rows.length`.
 */

/**
 * One row of the orders grid.
 *
 * `data`/`total` are the pre-formatted strings the screen shows; `dataIso` and
 * `valor` are the machine values the range filters read. Keeping both is not
 * redundancy — a range cannot be driven off "05/08/2026, 13:45" or "R$ 13,90",
 * and formatting on the fly would put the FUT-668 day/timestamp bug back.
 */
interface PedidoRow extends Record<string, unknown> {
  pedido: string;
  data: string;
  cliente: string;
  mesa: string;
  itens: string;
  total: string;
  metodo: string;
  pagamento: string;
  situacao: string;
  /** `AAAA-MM-DD`, compared lexicographically by the day range (FUT-668). */
  dataIso: string;
  /** The order total as a number, for the "Valor" range. */
  valor: number;
}

const ROWS: PedidoRow[] = [
  { pedido: "B75A6858", data: "05/08/2026, 13:45", cliente: "Luiz Gustavo", mesa: "—", itens: "Monster Absolutely Zero", total: "R$ 13,90", metodo: "PIX", pagamento: "Pago", situacao: "Em aberto", dataIso: "2026-08-05", valor: 13.9 },
  { pedido: "1D970689", data: "05/08/2026, 13:43", cliente: "Luiz Gustavo", mesa: "—", itens: "Água com gás 510ml Sem Sabor", total: "R$ 2,98", metodo: "PIX", pagamento: "Pago", situacao: "Em aberto", dataIso: "2026-08-05", valor: 2.98 },
  { pedido: "0112CF89", data: "03/08/2026, 21:11", cliente: "Charles Coutinho", mesa: "—", itens: "Coca-Cola Zero Açúcar 350ml", total: "R$ 5,90", metodo: "PIX", pagamento: "Pendente", situacao: "Em aberto", dataIso: "2026-08-03", valor: 5.9 },
  { pedido: "89E40634", data: "03/08/2026, 02:13", cliente: "Thompson Filgueiras", mesa: "—", itens: "TNT Zero Açúcar Maçã Verde 473ml", total: "R$ 8,90", metodo: "PIX", pagamento: "Pendente", situacao: "Em aberto", dataIso: "2026-08-03", valor: 8.9 },
  { pedido: "029B4E8E", data: "20/07/2026, 20:19", cliente: "Future Place Coworking", mesa: "—", itens: "Budweiser longneck 330ml Lager", total: "R$ 8,99", metodo: "Cartão", pagamento: "Pendente", situacao: "Cancelado", dataIso: "2026-07-20", valor: 8.99 },
  { pedido: "E6DB89A5", data: "15/07/2026, 15:06", cliente: "Thom MF", mesa: "—", itens: "Coca cola zero", total: "R$ 5,90", metodo: "PIX", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 5.9 },
  { pedido: "EBD68F9A", data: "15/07/2026, 15:03", cliente: "thompson filgueiras", mesa: "—", itens: "TNT Zero Açúcar Maçã Verde 473ml", total: "R$ 8,90", metodo: "Cartão", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 8.9 },
  { pedido: "997E514F", data: "15/07/2026, 15:02", cliente: "Thom MF", mesa: "—", itens: "Coca cola zero", total: "R$ 5,90", metodo: "PIX", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 5.9 },
  { pedido: "79DEDD84", data: "15/07/2026, 15:01", cliente: "Thom MF", mesa: "—", itens: "Coca cola zero", total: "R$ 5,90", metodo: "PIX", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 5.9 },
  { pedido: "2A0A365F", data: "15/07/2026, 15:01", cliente: "thompson filgueiras", mesa: "—", itens: "Coca-Cola Mini 220ml Zero Lata 220ml", total: "R$ 4,59", metodo: "PIX", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 4.59 },
  { pedido: "8DB72B1B", data: "15/07/2026, 00:26", cliente: "thompson filgueiras", mesa: "—", itens: "Red Bull Zero Sem Açúcar 250ml", total: "R$ 12,90", metodo: "Cartão", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 12.9 },
  { pedido: "A24B1A20", data: "15/07/2026, 00:26", cliente: "thompson filgueiras", mesa: "—", itens: "Baly Tradicional", total: "R$ 8,90", metodo: "Cartão", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 8.9 },
  { pedido: "96AF699E", data: "15/07/2026, 00:26", cliente: "thompson filgueiras", mesa: "—", itens: "Coca-Cola Zero Açúcar 350ml", total: "R$ 5,90", metodo: "PIX", pagamento: "Pago", situacao: "Cancelado", dataIso: "2026-07-15", valor: 5.9 },
  { pedido: "95A60F7A", data: "15/07/2026, 00:25", cliente: "thompson filgueiras", mesa: "—", itens: "Coca-Cola Mini 220ml Zero Lata 220ml", total: "R$ 4,59", metodo: "PIX", pagamento: "Pago", situacao: "Em aberto", dataIso: "2026-07-15", valor: 4.59 },
  { pedido: "06DB3998", data: "14/07/2026, 22:01", cliente: "Thompson Filgueiras", mesa: "—", itens: "Skol Beats 269ml Senses", total: "R$ 5,98", metodo: "PIX", pagamento: "Pendente", situacao: "Em aberto", dataIso: "2026-07-14", valor: 5.98 },
  { pedido: "0E6E389D", data: "14/07/2026, 22:01", cliente: "Thompson Filgueiras", mesa: "—", itens: "OREO Baunilha +2", total: "R$ 23,78", metodo: "PIX", pagamento: "Pendente", situacao: "Cancelado", dataIso: "2026-07-14", valor: 23.78 },
  { pedido: "29A4EFBD", data: "14/07/2026, 19:50", cliente: "thompson filgueiras", mesa: "—", itens: "Guaraná Antártica Zero açúcar 350ml", total: "R$ 4,90", metodo: "Cartão", pagamento: "Pago", situacao: "Em aberto", dataIso: "2026-07-14", valor: 4.9 },
  { pedido: "C73C50D2", data: "14/07/2026, 19:50", cliente: "thompson filgueiras", mesa: "—", itens: "Budweiser longneck 330ml Lager", total: "R$ 8,90", metodo: "Cartão", pagamento: "Pago", situacao: "Em aberto", dataIso: "2026-07-14", valor: 8.9 },
  { pedido: "2900A47C", data: "14/07/2026, 18:55", cliente: "Thom MF", mesa: "—", itens: "Coca cola zero", total: "R$ 5,90", metodo: "Cartão", pagamento: "Pendente", situacao: "Cancelado", dataIso: "2026-07-14", valor: 5.9 },
  { pedido: "EC5C6738", data: "14/07/2026, 18:55", cliente: "Thom MF", mesa: "—", itens: "Coca cola zero", total: "R$ 5,90", metodo: "PIX", pagamento: "Pendente", situacao: "Cancelado", dataIso: "2026-07-14", valor: 5.9 },
];

/** What the real endpoint reports across all pages; the export is page 1 of it. */
const TOTAL_COUNT = 34;

const PAGAMENTO_COLOR: Record<string, string> = { Pago: "success", Pendente: "warning" };
const SITUACAO_COLOR: Record<string, string> = { "Em aberto": "info", Cancelado: "error" };

/** Status cells are chips so a row's state reads at a glance, as on the real screen. */
function statusCell(palette: Record<string, string>) {
  return ({ value }: { value: unknown }): React.JSX.Element => {
    const label = String(value);
    return <Chip label={label} size="small" variant="outlined" color={palette[label] ?? "default"} />;
  };
}

const columns: DataViewColumn<PedidoRow>[] = [
  // The order id identifies the row, so it stays put and stays visible.
  { id: "pedido", header: "Pedido", accessor: "pedido", searchable: true, hideable: false, enableSort: true },
  { id: "data", header: "Data", accessor: "data", enableSort: true },
  { id: "cliente", header: "Cliente", accessor: "cliente", searchable: true, enableSort: true },
  { id: "mesa", header: "Mesa", accessor: "mesa" },
  { id: "itens", header: "Itens", accessor: "itens", searchable: true, minWidth: 240 },
  { id: "total", header: "Total", accessor: "total", enableSort: true },
  { id: "metodo", header: "Método", accessor: "metodo" },
  { id: "pagamento", header: "Pagamento", accessor: "pagamento", cell: statusCell(PAGAMENTO_COLOR) },
  { id: "situacao", header: "Situação", accessor: "situacao", cell: statusCell(SITUACAO_COLOR) },
];

const ALL_COLUMNS = columns.map((column) => column.id);

/** Distinct values, in first-seen order — the option lists follow the data. */
function optionsFor(key: keyof PedidoRow) {
  return [...new Set(ROWS.map((row) => String(row[key])))].map((value) => ({ value, label: value }));
}

/** Pill order matches the screen: Pagamento, Situação, Método, then the ranges. */
const fields: FilterFieldConfig<PedidoRow>[] = [
  { id: "pagamento", label: "Pagamento", options: optionsFor("pagamento") },
  { id: "situacao", label: "Situação", options: optionsFor("situacao") },
  { id: "metodo", label: "Método", options: optionsFor("metodo") },
  // The customer list grows with the tenant, so it gets the searchable dropdown
  // rather than a checkbox per name — `searchEnabled` is for unbounded sets.
  { id: "cliente", label: "Cliente", options: optionsFor("cliente"), control: "multiselect", searchEnabled: true },
];

const rangeFields: RangeFieldConfig<PedidoRow>[] = [
  // kind "day", not numbers over timestamps: coercing an "até" of 2026-07-15
  // into an instant lands on that day's midnight and drops the final day
  // whole (FUT-668). The accessor hands back the ISO day for a lexicographic
  // compare.
  { id: "data", label: "Data", kind: "day", accessor: (row) => row.dataIso },
  { id: "valor", label: "Valor", kind: "number", unit: "R$", step: 0.01, accessor: (row) => row.valor },
];

/**
 * "Visão principal" is the built-in no-filter default and is NOT in this list —
 * these are the saved views that sit beside it in the menu.
 */
const views: SavedViewSummary[] = [
  {
    id: "pendentes",
    name: "Pagamento pendente",
    description: "Pedidos em aberto ainda não pagos",
    state: {
      search: "",
      pills: { pagamento: ["Pendente"], situacao: ["Em aberto"] },
      sortBy: [{ id: "data", dir: "desc" }],
      visibleColumns: ALL_COLUMNS,
    },
    shared: true,
    pinned: true,
    isDefault: false,
    isOwner: true,
  },
  {
    id: "cancelados",
    name: "Cancelados",
    description: null,
    state: {
      search: "",
      pills: { situacao: ["Cancelado"] },
      sortBy: [{ id: "data", dir: "desc" }],
      // Method and table say nothing once an order is cancelled, so this view
      // drops them rather than carrying two dead columns.
      visibleColumns: ALL_COLUMNS.filter((id) => id !== "metodo" && id !== "mesa"),
    },
    shared: false,
    pinned: false,
    isDefault: false,
    isOwner: true,
  },
  {
    id: "equipe",
    name: "Ticket alto (equipe)",
    description: "Compartilhada pela equipe — somente leitura",
    state: {
      search: "",
      pills: {},
      ranges: { valor: { min: 8 } },
      sortBy: [{ id: "total", dir: "desc" }],
      visibleColumns: ALL_COLUMNS,
    },
    shared: true,
    pinned: false,
    isDefault: false,
    // Not the owner: the menu must offer no edit, delete, pin or share on this
    // one (contract.md — "isOwner: false → no destructive or ownership
    // affordances").
    isOwner: false,
  },
];

const rowActions: RowAction<PedidoRow>[] = [
  { id: "detalhes", label: "Ver detalhes", bulk: false, onSelect: () => {} },
  { id: "recibo", label: "Enviar recibo", onSelect: () => {} },
  {
    id: "cancelar",
    label: "Cancelar pedido",
    color: "error",
    // A cancelled order has nowhere left to go, so the action hides on those
    // rows; in bulk it runs only on the ones that pass.
    isVisible: (row) => row.situacao !== "Cancelado",
    onSelect: () => {},
  },
];

/**
 * ONE state-machine definition drives both the scope tabs and the board
 * columns, so the two can never drift into disagreeing about what states exist.
 */
const SITUACOES = [
  { value: "Em aberto", label: "Em aberto" },
  { value: "Cancelado", label: "Cancelado" },
] as const;

/**
 * A scope PARTITIONS the page and is exclusive; a pill NARROWS inside it and is
 * multi-select. That is why these tabs are not just another
 * `FilterFieldConfig`, and why their counts have to come off the response —
 * under pagination no client can compute a whole-query count.
 */
const scopes: ScopeConfig[] = [
  { id: "todos", label: "Todos" },
  ...SITUACOES.map((s) => ({ id: s.value, label: s.label, predicate: { situacao: s.value } })),
];

/**
 * Counts for every scope, computed over search + pills + ranges but IGNORING
 * the active scope — otherwise selecting "Cancelado" would zero every other tab
 * and the strip would tell the user their other buckets had emptied.
 *
 * Whole-query counts, not page counts: `totalCount` is 34 while the page holds
 * 20, so these are what the server reports, not what the browser can see.
 */
const scopeCounts: Record<string, number> = { todos: TOTAL_COUNT, "Em aberto": 12, Cancelado: 22 };

/** The board groups by the same field the scopes partition by. */
const board: BoardConfig<PedidoRow> = {
  groupBy: "situacao",
  groups: SITUACOES.map((s) => ({ value: s.value, label: s.label })),
  sumBy: "valor",
  // The page's own formatter, so the board prints money in the store's
  // currency rather than inventing a second convention.
  formatSum: (total) => `R$ ${total.toFixed(2).replace(".", ",")}`,
  // A row whose state the front end does not declare is COLLECTED here, never
  // dropped — a pedido must not vanish because the backend grew a new state.
  extraLabel: "Sem situação",
};

/** The entity's own card, shared by the Cards and Quadro layouts. */
function renderPedidoCard(row: PedidoRow, selection: DataViewCardSelection): React.JSX.Element {
  return (
    <BaseCard
      title={row.pedido}
      subtitle={`${row.cliente} · ${row.total}`}
      selected={selection.selected}
      onToggleSelect={selection.toggle}
      imageFallback={<Box sx={{ fontSize: "1.5rem" }}>🧾</Box>}
    >
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
        <Chip label={row.pagamento} size="small" variant="outlined" color={PAGAMENTO_COLOR[row.pagamento]} />
        <Chip label={row.metodo} size="small" variant="outlined" />
      </Box>
    </BaseCard>
  );
}

/** Lista is one full-width row per pedido — denser than a card, richer than a cell. */
function renderPedidoListRow(row: PedidoRow, selection: DataViewCardSelection): React.JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: selection.selected ? "action.selected" : undefined,
      }}
    >
      <Box sx={{ fontWeight: 600, minWidth: 96 }}>{row.pedido}</Box>
      <Box sx={{ color: "text.secondary", minWidth: 150 }}>{row.data}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{row.itens}</Box>
      <Box sx={{ minWidth: 90, textAlign: "right" }}>{row.total}</Box>
      <Chip label={row.situacao} size="small" variant="outlined" color={SITUACAO_COLOR[row.situacao]} />
    </Box>
  );
}

/**
 * Exportar. The grid hands back the live query with `page: 1` and `pageSize`
 * widened to the whole matched total — "everything this filter selects", not
 * the loaded page — plus the visible columns in the operator's current order.
 * The host re-queries and writes the file; the grid never fetches.
 */
const exportConfig: DataViewExport = { onExport: fn() };

/** Inert stubs: a story owns no backend and no router. */
const persistence: DataViewPersistence = {
  create: () => Promise.resolve({ ok: true }),
  update: () => Promise.resolve({ ok: true }),
  remove: () => Promise.resolve({ ok: true }),
};
const router: DataViewRouter = { syncViewParam: () => {}, refresh: () => {} };

/**
 * The page chrome above the grid.
 *
 * Not `DataViewsTableBase`'s `title` / `headerActions` props: `DataViewsGrid`
 * declares both and renders neither, so passing them draws nothing. The real
 * screen composes this row itself (future-pay uses `Dashboard.Header` +
 * `Dashboard.Action`), and so does this story.
 */
function PedidosHeader(): React.JSX.Element {
  return (
    <Box>
      <Box sx={{ px: 3, pt: 2 }}>
        <Breadcrumbs items={[{ label: "Início", href: "#" }, { label: "Pedidos" }]} />
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box component="h1" sx={{ m: 0, fontSize: "1.75rem", fontWeight: 700 }}>
            Pedidos
          </Box>
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
          <SettingsOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </Box>
        <Button variant="outline" size="sm" icon={<FileDownloadOutlinedIcon fontSize="small" />} iconPosition="left">
          Export
        </Button>
      </Box>
    </Box>
  );
}

const meta: Meta<typeof DataViewsTableBase<PedidoRow>> = {
  title: "DataDisplay/DataViews/Pedidos",
  component: DataViewsTableBase,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The orders screen built from a real export: 20 pedidos across 6 customers, two payment methods and two states. `Default` filters in the browser so every control is live; `ServerMode` is how an admin list actually runs — the grid renders the page it was handed and emits a query instead of filtering.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof DataViewsTableBase<PedidoRow>>;

const base = {
  rows: ROWS,
  columns,
  fields,
  rangeFields,
  views,
  rowActions,
  persistence,
  router,
  exportConfig,
  getRowId: (row: PedidoRow) => row.pedido,
  testIdPrefix: "pedidos",
  // The Exibir panel only offers a format the table can actually render, so
  // these three are what put Lista, Grade and Quadro in it at all
  // (`data-views-layout-context.tsx`: renderCard → grade, renderListRow →
  // lista, board + renderCard → quadro). They belong on the shared base rather
  // than on one story: without them every other story silently degrades to a
  // Tabela-only panel, which reads as "the formats are missing" rather than
  // "this story did not opt in".
  board,
  renderCard: renderPedidoCard,
  renderListRow: renderPedidoListRow,
  // Filters on one line with the search box, which is the screen's real
  // toolbar. `false` hides them behind the slide-in panel — covered by the
  // FilterPanel story rather than left as the default nobody asked for.
  inlineFilters: true,
  alwaysShowSearch: true,
  // Explicit spies, not left to preview.tsx's `^on[A-Z].*` argTypesRegex —
  // Storybook 9 throws ImplicitActionsDuringRendering when a story renders an
  // action arg it inferred rather than one that was passed.
  onRowClick: fn(),
  onVisibleRowsChange: fn(),
} satisfies Partial<React.ComponentProps<typeof DataViewsTableBase<PedidoRow>>>;

function screen(args: React.ComponentProps<typeof DataViewsTableBase<PedidoRow>>): React.JSX.Element {
  return (
    <Box>
      <PedidosHeader />
      <Box sx={{ px: 3, pb: 3 }}>
        <DataViewsTableBase<PedidoRow> {...args} />
      </Box>
    </Box>
  );
}

/** The screen as it loads: no view applied, filtering in the browser. */
export const Default: Story = {
  args: base,
  render: screen,
};

/**
 * How the screen actually runs. `server` flips the grid to backend-driven, so
 * it never filters, sorts or paginates in the browser — it renders exactly the
 * page it was handed, the counter reads the server's total ("20 de 34") rather
 * than `rows.length`, and every control emits `onQueryChange` for the host to
 * act on. Watch the Actions panel while filtering.
 */
export const ServerMode: Story = {
  args: {
    ...base,
    alwaysShowSearch: true,
    inlineFilters: true,
    server: {
      totalCount: TOTAL_COUNT,
      page: 1,
      pageSize: ROWS.length,
      // The host owns the fetch and the debounce; the component only announces.
      onQueryChange: fn(),
    },
  },
  render: screen,
};

/**
 * The full screen: scope tabs above the toolbar, and every format the Exibir
 * panel offers — Tabela, Lista, Cards and Quadro — plus row height.
 *
 * Scopes are server mode only, because their counts are whole-query counts the
 * browser cannot compute under pagination. Switching format or row height is
 * presentation and emits NO query; switching scope does.
 */
export const ScopesAndBoard: Story = {
  args: {
    ...base,
    scopes,
    scopeFieldId: "situacao",
    server: {
      totalCount: TOTAL_COUNT,
      page: 1,
      pageSize: ROWS.length,
      scopeCounts,
      onQueryChange: fn(),
    },
  },
  render: screen,
};

/**
 * The Quadro (board) layout: the loaded page as columns of the entity's card.
 *
 * Its counts are the PAGE's, not the query's — the header says "Nesta página"
 * precisely so a column reading 8 is not mistaken for a total of 8 when the
 * server holds 34.
 */
export const Board: Story = {
  args: { ...ScopesAndBoard.args, defaultLayout: "board" },
  render: screen,
};

/** The Lista layout: one full-width, entity-rendered row per pedido. */
export const List: Story = {
  args: { ...ScopesAndBoard.args, defaultLayout: "list" },
  render: screen,
};

/**
 * The Cards layout: the entity's own tile, and the one format whose density
 * control counts cards per line rather than row height.
 */
export const Cards: Story = {
  args: { ...ScopesAndBoard.args, defaultLayout: "cards" },
  render: screen,
};

/**
 * The Tabela layout, stated explicitly rather than relied on as the default —
 * all four formats then have a story, and a regression in the default cannot
 * hide behind one of them.
 */
export const Table: Story = {
  args: { ...ScopesAndBoard.args, defaultLayout: "table" },
  render: screen,
};

/** Opens with the pinned "Pagamento pendente" view already applied. */
export const SavedViewApplied: Story = {
  args: { ...base, initialViewId: "pendentes" },
  render: screen,
};

/**
 * The responsive filter UX, stated explicitly rather than relied on as the
 * default: filters sit in a row beside the search box (and collapse into a
 * modal on small screens). Collapsing is presentation only — it never drops a
 * filter or changes the rendered rows.
 */
export const InlineFilters: Story = {
  args: { ...base, inlineFilters: true },
  render: screen,
};

/**
 * The other half of that switch: `inlineFilters: false` puts the filters back
 * behind the "Filtros" slide-in panel. Kept as its own story because the base
 * now runs inline, and the panel is still what a narrow screen falls back to.
 */
export const FilterPanel: Story = {
  args: { ...base, inlineFilters: false },
  render: screen,
};

/**
 * No pedidos at all — distinct from "no matches", which keeps the filter row so
 * the user can widen the query that emptied it.
 */
export const Empty: Story = {
  args: {
    ...base,
    rows: [],
    emptyState: (
      <Box sx={{ py: 6, textAlign: "center", color: "text.secondary" }}>
        Nenhum pedido encontrado.
      </Box>
    ),
  },
  render: screen,
};
