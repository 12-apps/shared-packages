import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn, FilterFieldConfig, RangeFieldConfig } from "../data-views-types";

/**
 * THE FILTER BAR'S PRICES FOLLOW THE TYPE (FUT-2598).
 *
 * The collapse ladder compares a MEASURED bar width against what each control
 * costs. The controls are drawn through the theme's type scale, so their prices
 * — `estimateWidth` per pill, `RESERVED` for the furniture, the gap between
 * two controls — have to scale with it too. Priced in raw design px, a denser
 * theme (`fontSize: 12`, every length × 12/14) shed pills into "Mais" that its
 * smaller pills had room for, and a roomier one kept pills that overflowed.
 *
 * jsdom has no ResizeObserver, so the bar width is whatever the fake reports.
 */

interface Row extends Record<string, unknown> {
  id: string;
  nome: string;
  status: string;
  metodo: string;
  origem: string;
  valor: number;
}

const rows: Row[] = [{ id: "1", nome: "Ana", status: "pago", metodo: "pix", origem: "site", valor: 10 }];
const columns: DataViewColumn<Row>[] = [{ id: "nome", header: "Nome", accessor: "nome", searchable: true }];
const options = [
  { value: "a", label: "Opção A" },
  { value: "b", label: "Opção B" },
];
const fields: FilterFieldConfig<Row>[] = [
  { id: "status", label: "Status do pagamento", accessor: (row) => row.status, options },
  { id: "metodo", label: "Método de pagamento", accessor: (row) => row.metodo, options },
  { id: "origem", label: "Origem do pedido", accessor: (row) => row.origem, options },
];
const rangeFields: RangeFieldConfig<Row>[] = [
  { id: "valor", label: "Valor cobrado", accessor: (row) => row.valor, kind: "number" },
];

const DEFAULT_THEME = createTheme();
const DENSE_THEME = createTheme({ typography: { fontSize: 12 } });
/** How much every design length shrinks under the dense theme. */
const DENSE_RATIO = 12 / 14;

/** A desktop viewport (so the inline bar renders) and a bar that measures `width`. */
function stubBar(width: number): void {
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

/** Which filter controls the bar keeps inline, by field id, once it has measured. */
async function inlineAt(theme: ReturnType<typeof createTheme>, width: number): Promise<string[]> {
  stubBar(width);
  render(
    <ThemeProvider theme={theme}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={fields}
        rangeFields={rangeFields}
        getRowId={(row) => row.id}
        testIdPrefix="lista"
        inlineFilters
      />
    </ThemeProvider>,
  );
  await act(async () => undefined);
  const shown = ["status", "metodo", "origem", "valor"].filter(
    (id) => screen.queryByTestId(`lista-filter-${id}`) ?? screen.queryByTestId(`lista-range-${id}`),
  );
  cleanup();
  return shown;
}

afterEach(() => vi.unstubAllGlobals());

describe("the filter bar's prices under a non-default type scale", () => {
  it("keeps every pill on a bar the default theme has to shed from", async () => {
    // At MUI's default, 1100px holds two of the four controls.
    expect((await inlineAt(DEFAULT_THEME, 1100)).length).toBeLessThan(4);
    expect(await inlineAt(DENSE_THEME, 1100)).toEqual(["status", "metodo", "origem", "valor"]);
  });

  it("sheds exactly what the default theme sheds on a bar scaled by the same ratio", async () => {
    // Every price scales with the type, so a bar scaled by the type's ratio is
    // the same bar: the cut lands on the same control. (Widths chosen off the
    // exact ties — at 950 the third pill fits to the pixel, and float rounding
    // is not what this is about.)
    for (const width of [925, 1000, 1150, 1300]) {
      const atDefault = await inlineAt(DEFAULT_THEME, width);
      expect(await inlineAt(DENSE_THEME, width * DENSE_RATIO), `bar of ${width}px`).toEqual(atDefault);
    }
  });
});
