import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { toOverflowFields } from "../data-views-overflow";
import type {
  DataViewColumn,
  DataViewQuery,
  DataViewServer,
  FilterFieldConfig,
  RangeFieldConfig,
} from "../data-views-types";

/**
 * PROGRESSIVE FILTER COLLAPSE.
 *
 * Two rules, and both come from watching the all-or-nothing version fail:
 * controls shed ONE AT A TIME, and an APPLIED filter never hides. The second is
 * the one that matters — a filter you cannot see is a filter you forget you
 * set, and then the list is "wrong" for a reason nothing on screen explains.
 *
 * jsdom has no ResizeObserver, so these tests install one: a fake that reports
 * whatever width the test asks for. That is the point of the feature — the cut
 * is MEASURED, not breakpointed, so the only honest way to test it is to drive
 * the measurement.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  status: string;
  metodo: string;
  origem: string;
  valor: number;
  dataIso: string;
}

const rows: Row[] = [
  { id: "1", nome: "Ana", status: "pago", metodo: "pix", origem: "site", valor: 10, dataIso: "2026-08-06" },
  { id: "2", nome: "Bruno", status: "recusado", metodo: "credito", origem: "app", valor: 25, dataIso: "2026-08-07" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "nome", header: "Nome", accessor: "nome", searchable: true },
  { id: "status", header: "Status", accessor: "status" },
];

const fields: FilterFieldConfig<Row>[] = [
  {
    id: "status",
    label: "Status do pagamento",
    accessor: (row) => row.status,
    options: [
      { value: "pago", label: "Pago" },
      { value: "recusado", label: "Recusado" },
    ],
  },
  {
    id: "metodo",
    label: "Método de pagamento",
    accessor: (row) => row.metodo,
    options: [
      { value: "pix", label: "Pix" },
      { value: "credito", label: "Crédito" },
    ],
  },
  {
    id: "origem",
    label: "Origem do pedido",
    accessor: (row) => row.origem,
    options: [
      { value: "site", label: "Site" },
      { value: "app", label: "Aplicativo" },
    ],
  },
];

const rangeFields: RangeFieldConfig<Row>[] = [
  { id: "valor", label: "Valor cobrado", accessor: (row) => row.valor, kind: "number" },
];

/**
 * Report a desktop viewport, so `inlineFilters` actually renders the inline bar
 * — jsdom matches no media query, and the grid then falls back to the filter
 * MODAL, where there is no bar to collapse in the first place.
 */
function stubWideViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("min-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/**
 * Install a ResizeObserver that reports a fixed content width.
 *
 * It fires once on `observe`, synchronously — real observers deliver their
 * first callback on the next frame, but the hook only reads `contentRect.width`
 * and a frame's delay would just make every assertion wait on a timer.
 */
function stubResizeObserver(width: number): void {
  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

function renderBar(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}) {
  stubWideViewport();
  return render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={fields}
        rangeFields={rangeFields}
        getRowId={(row) => row.id}
        testIdPrefix="lista"
        inlineFilters
        {...props}
      />
    </ThemeProvider>,
  );
}

/** Which filter controls are rendered inline on the bar, by field id. */
function inlineIds(): string[] {
  return ["status", "metodo", "origem", "valor"].filter(
    (id) => screen.queryByTestId(`lista-filter-${id}`) ?? screen.queryByTestId(`lista-range-${id}`),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("toOverflowFields", () => {
  it("lists pills before ranges, in the order the bar renders them", () => {
    const all = toOverflowFields(fields, rangeFields);
    expect(all.map((field) => field.id)).toEqual(["status", "metodo", "origem", "valor"]);
    expect(all.map((field) => field.group)).toEqual(["pill", "pill", "pill", "range"]);
  });
});

/**
 * THE OVERFLOW PANEL'S RANGE BOUNDS.
 *
 * This panel used to build its own pair of inputs — a raw `<input type="date">`
 * for a day, a bare `type="number"` plus `Number(raw)` for a value. So the
 * masked `dd/mm/aaaa` field existed only while the filter FITTED on the bar:
 * the moment "Data" overflowed it reverted to the very control the mask
 * replaced, and a merchant on a narrow screen never saw the fix at all. The
 * bounds now come from the same `RangeBounds` the pill uses, so the two
 * surfaces cannot drift again (FUT-744).
 */
describe("the overflow panel's range bounds", () => {
  const withDay: RangeFieldConfig<Row>[] = [
    { id: "data", label: "Data do pedido", accessor: (row) => row.dataIso, kind: "day" },
    ...rangeFields,
  ];

  /** Narrow enough that every range field is pushed behind "Mais". */
  async function openOverflow(): Promise<void> {
    stubResizeObserver(320);
    renderBar({ rangeFields: withDay });
    fireEvent.click(await screen.findByTestId("lista-more-filters"));
    await screen.findByTestId("lista-more-panel");
  }

  /** Type `text` one character at a time, the way a keyboard delivers it. */
  function typeSequentially(element: HTMLInputElement, text: string): void {
    for (const character of text) {
      fireEvent.change(element, { target: { value: element.value + character } });
    }
  }

  it("takes a whole day as one run of digits, which the native input could not", async () => {
    await openOverflow();
    const min = (await screen.findByTestId("lista-more-data-min")) as HTMLInputElement;
    // A native date input is three segments wearing one box; the masked one is
    // ordinary text, and that difference is the entire bug this covers.
    expect(min).toHaveAttribute("type", "text");
    typeSequentially(min, "060820");
    await waitFor(() => expect(min).toHaveValue("06/08/20"));
  });

  it("keeps the decimal comma on a value bound, rather than eating it", async () => {
    await openOverflow();
    const min = (await screen.findByTestId("lista-more-valor-min")) as HTMLInputElement;
    expect(min).toHaveAttribute("type", "text");
    // `Number("12,50")` is NaN — the old panel silently dropped the fraction.
    typeSequentially(min, "12,50");
    await waitFor(() => expect(min).toHaveValue("12,50"));
  });
});

describe("the filter bar's progressive collapse", () => {
  it("keeps every control inline when nothing measures it (SSR / no observer)", async () => {
    renderBar();
    expect(inlineIds()).toEqual(["status", "metodo", "origem", "valor"]);
    await waitFor(() => expect(screen.queryByTestId("lista-more-filters")).toBeNull());
  });

  it("keeps every control inline when they all fit", async () => {
    stubResizeObserver(2400);
    renderBar();
    await waitFor(() => expect(inlineIds()).toEqual(["status", "metodo", "origem", "valor"]));
    await waitFor(() => expect(screen.queryByTestId("lista-more-filters")).toBeNull());
  });

  it("sheds only what does not fit, badging how many went behind Mais", async () => {
    // Wide enough for SOME but not all: controls are priced at their real
    // rendered width (label + padding + chevron), so the partial-shed band
    // sits higher than it did when the estimate under-priced every chip.
    stubResizeObserver(1150);
    renderBar();

    const more = await screen.findByTestId("lista-more-filters");
    const shown = inlineIds();
    // One at a time, not all-or-nothing: something stays, something goes.
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(4);
    expect(more).toHaveAttribute(
      "aria-label",
      `Mais filtros: ${4 - shown.length} sem espaço na barra`,
    );
  });

  it("never hides an APPLIED filter, even when it was the one that overflowed", async () => {
    stubResizeObserver(900);
    renderBar();

    // Whatever collapsed first, apply it from inside the overflow…
    await screen.findByTestId("lista-more-filters");
    const hidden = ["status", "metodo", "origem", "valor"].filter((id) => !inlineIds().includes(id));
    const target = hidden[0];
    expect(target).toBeDefined();

    fireEvent.click(screen.getByTestId("lista-more-filters"));
    await screen.findByTestId("lista-more-panel");
    const option = document.querySelector<HTMLElement>(
      `[data-testid^="lista-more-${target}-"] input`,
    );
    if (!option) throw new Error(`no option control for ${target}`);
    fireEvent.click(option);

    // …and it takes a visible slot back.
    await waitFor(() => expect(inlineIds()).toContain(target));
  });

  it("drops the Exibir/Exportar labels before it touches the search", async () => {
    // Step 2 of the ladder, and ONLY step 2: wide enough for the icons plus a
    // full-width search box, not wide enough for the labelled controls too.
    stubResizeObserver(620);
    renderBar({ exportConfig: { onExport: vi.fn() } });

    await waitFor(() => expect(screen.getByTestId("lista-display-trigger")).toHaveAttribute("title", "Exibir"));
    expect(screen.getByTestId("lista-export-trigger")).toHaveAttribute("title", "Exportar");
    // …and the search is still a box, because step 4 was not needed.
    expect(screen.getByTestId("lista-search-all")).toBeInTheDocument();
  });

  it("collapses the search to an icon only as the LAST step, and flags an applied one", async () => {
    stubResizeObserver(420);
    renderBar({ appliedState: { search: "CHAR_7", pills: {}, ranges: {}, sortBy: [], visibleColumns: ["nome", "status"] } });

    const trigger = await screen.findByTestId("lista-search-all-collapsed");
    expect(trigger).toHaveAttribute("aria-label", "Buscar");
    // A collapsed control that is STILL FILTERING has to say so.
    expect(trigger.querySelector("span")).toBeInTheDocument();

    // It expands on click, and comes back with the term intact.
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId("lista-search-all")).toHaveValue("CHAR_7"));
  });

  it("keeps the labels and the search box when there is room for both", async () => {
    stubResizeObserver(2400);
    renderBar({ exportConfig: { onExport: vi.fn() } });

    await waitFor(() => expect(screen.getByTestId("lista-search-all")).toBeInTheDocument());
    expect(screen.getByTestId("lista-display-trigger")).not.toHaveAttribute("title");
    expect(screen.getByTestId("lista-export-trigger")).not.toHaveAttribute("title");
  });

  it("re-splits when the bar is resized, without emitting a query", async () => {
    const queries: DataViewQuery[] = [];
    const server: DataViewServer = {
      totalCount: 214,
      page: 1,
      pageSize: 25,
      onQueryChange: (query) => queries.push(query),
    };
    // A container's property, not a closed-over binding: the observer publishes
    // its "resize the bar" handle out to the test, and that outlives re-renders.
    const bar: { resize?: (width: number) => void } = {};
    class ResizableObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        bar.resize = (width: number) =>
          this.callback(
            [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        bar.resize(2400);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizableObserver);

    renderBar({ server });
    await waitFor(() => expect(inlineIds()).toHaveLength(4));

    act(() => bar.resize?.(700));

    await screen.findByTestId("lista-more-filters");
    expect(inlineIds().length).toBeLessThan(4);
    // Collapsing is PRESENTATION: no control was cleared, so nothing re-queried.
    expect(queries).toHaveLength(0);
  });
});
