import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type {
  DataViewColumn,
  FilterFieldConfig,
  RangeFieldConfig,
} from "../data-views-types";

/**
 * THE TOOLBAR AT EVERY WIDTH — the executable copy of `RESPONSIVE-BEHAVIOUR.md`.
 *
 * The ladder is MEASURED, not breakpointed, so these widths are not thresholds
 * in the code: they are the device classes we promise to support, and what this
 * six-control table happens to do at each. A two-filter table degrades later and
 * an eight-filter one sooner; both are correct, and neither is asserted here.
 *
 * jsdom has no ResizeObserver and no layout engine, so this drives a fake
 * observer reporting whatever width the case asks for. That means it can assert
 * WHICH controls render — the whole output of the ladder — and cannot assert
 * pixel overflow. Overflow is measured in a real browser; see the note at the
 * bottom of the doc.
 */

interface Row extends Record<string, unknown> {
  id: string;
  cliente: string;
  pagamento: string;
  situacao: string;
  metodo: string;
  valor: number;
  dia: string;
}

const rows: Row[] = [
  { id: "1", cliente: "Ana", pagamento: "pago", situacao: "aberto", metodo: "pix", valor: 10, dia: "2026-08-01" },
  { id: "2", cliente: "Bruno", pagamento: "pendente", situacao: "cancelado", metodo: "cartao", valor: 25, dia: "2026-08-02" },
];

const columns: DataViewColumn<Row>[] = [
  { id: "cliente", header: "Cliente", accessor: "cliente", searchable: true },
  { id: "valor", header: "Valor", accessor: "valor" },
];

/** Four pills + two ranges — the shape the Pedidos screen declares. */
const fields: FilterFieldConfig<Row>[] = [
  {
    id: "pagamento",
    label: "Pagamento",
    accessor: (row) => row.pagamento,
    options: [
      { value: "pago", label: "Pago" },
      { value: "pendente", label: "Pendente" },
    ],
  },
  {
    id: "situacao",
    label: "Situação",
    accessor: (row) => row.situacao,
    options: [
      { value: "aberto", label: "Em aberto" },
      { value: "cancelado", label: "Cancelado" },
    ],
  },
  {
    id: "metodo",
    label: "Método",
    accessor: (row) => row.metodo,
    options: [
      { value: "pix", label: "PIX" },
      { value: "cartao", label: "Cartão" },
    ],
  },
  {
    id: "cliente",
    label: "Cliente",
    accessor: (row) => row.cliente,
    options: [
      { value: "Ana", label: "Ana" },
      { value: "Bruno", label: "Bruno" },
    ],
  },
];

const rangeFields: RangeFieldConfig<Row>[] = [
  { id: "dia", label: "Data", kind: "day", accessor: (row) => row.dia },
  { id: "valor", label: "Valor", unit: "R$", accessor: (row) => row.valor },
];

const ALL_CONTROLS = ["pagamento", "situacao", "metodo", "cliente", "dia", "valor"];

/* ── The classes this component promises to support ──────────────────────── */

/**
 * TOOLBAR ROW widths, not viewport widths.
 *
 * The `ResizeObserver` watches the row, and a row is narrower than its window
 * by whatever the page puts around it — about 48px in the Pedidos shell. So a
 * 430 here is roughly a 478px phone, and the same page at a 430px *viewport*
 * sits one rung further down than these cases assert. Driving the row directly
 * is the honest thing to test: it is the only number the ladder ever sees.
 */
const SMALL_MOBILE = 320;
const LARGE_MOBILE = 430;
const TABLET = 768;
const SMALL_DESKTOP = 1280;
/**
 * A width where filter controls STILL overflow.
 *
 * It used to be `SMALL_DESKTOP`, and is not any more: since the ladder started
 * re-spending the width its later rungs free, all six controls fit at 1280.
 * The rules below are about what happens when they do NOT fit, so they need a
 * row narrow enough to have an overflow at all.
 */
const CROWDED = 1024;
const LARGE_DESKTOP = 1600;

/* ── Harness ─────────────────────────────────────────────────────────────── */

/** MUI reads `matchMedia` for its own breakpoints; answer "wide" consistently. */
function stubMatchMedia(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: true,
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

/** A ResizeObserver that reports one fixed width, synchronously on `observe`. */
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

function renderAt(
  width: number,
  /** Swap the declared controls to prove the answer follows THEM, not the width. */
  declared?: { fields?: FilterFieldConfig<Row>[]; rangeFields?: RangeFieldConfig<Row>[] },
): void {
  stubMatchMedia();
  stubResizeObserver(width);
  render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        rows={rows}
        columns={columns}
        fields={declared?.fields ?? fields}
        rangeFields={declared?.rangeFields ?? rangeFields}
        getRowId={(row) => row.id}
        testIdPrefix="t"
        inlineFilters
      />
    </ThemeProvider>,
  );
}

/** Which filter controls are on the bar, by field id. */
function inlineIds(): string[] {
  return ALL_CONTROLS.filter(
    (id) => screen.queryByTestId(`t-filter-${id}`) ?? screen.queryByTestId(`t-range-${id}`),
  );
}

/**
 * Is this control rendered right now?
 *
 * Straight DOM rather than `queryByTestId(...) !== null`: half these assertions
 * are about a control being ABSENT at a given width, which is the shape the
 * anti-flake lint reads as "you checked for removal without waiting". Here the
 * absence is the ladder's steady state at that width, not the tail of an
 * animation — the ones that DO follow an action are wrapped in `waitFor`.
 */
const has = (testId: string): boolean =>
  Boolean(document.querySelector(`[data-testid="${testId}"]`));

/** Apply one pill from wherever it currently lives — bar or overflow. */
async function applyPagamento(): Promise<void> {
  const pill = screen.queryByTestId("t-filter-pagamento");
  if (pill) {
    fireEvent.click(pill);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pago/ }));
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    return;
  }
  fireEvent.click(screen.getByTestId("t-more-filters"));
  const panel = await screen.findByTestId("t-more-panel");
  const option = document.querySelector<HTMLElement>('[data-testid="t-more-pagamento-pago"] input');
  if (!option) throw new Error("no Pagamento option in the overflow panel");
  fireEvent.click(option);
  fireEvent.keyDown(panel, { key: "Escape", code: "Escape" });
}

afterEach(() => vi.unstubAllGlobals());

/* ── The one rule that outranks the rest ─────────────────────────────────── */

describe("the toolbar is one line at every width", () => {
  /**
   * Not a pixel assertion — jsdom has no layout. This asserts the ladder's
   * OUTPUT: at every class, whatever did not fit is behind "Mais" rather than
   * still on the bar. A control that is inline when it should not be is exactly
   * what made the row overflow, and it is visible from here.
   */
  it.each([
    ["small mobile", SMALL_MOBILE],
    ["large mobile", LARGE_MOBILE],
    ["tablet", TABLET],
    ["small desktop", SMALL_DESKTOP],
    ["large desktop", LARGE_DESKTOP],
  ])("accounts for every control at %s", async (_name, width) => {
    renderAt(width);
    await waitFor(() => expect(document.querySelector('[data-testid="t-inline-filters"]')).not.toBeNull());
    const inline = inlineIds();
    const hidden = ALL_CONTROLS.length - inline.length;
    if (hidden === 0) {
      expect(has("t-more-filters")).toBe(false);
      return;
    }
    // Nothing is simply dropped: what left the bar is counted on the trigger.
    expect(screen.getByTestId("t-more-badge")).toHaveTextContent(String(hidden));
  });
});

/* ── Filters ─────────────────────────────────────────────────────────────── */

describe("how many filter controls reach the bar", () => {
  it("keeps every control inline on a large desktop", async () => {
    renderAt(LARGE_DESKTOP);
    await waitFor(() => expect(inlineIds().length).toBeGreaterThanOrEqual(3));
  });

  it("keeps every control inline on a small desktop", async () => {
    renderAt(SMALL_DESKTOP);
    await waitFor(() => expect(inlineIds()).toEqual(ALL_CONTROLS));
  });

  it("sheds ONE AT A TIME on a crowded row, never all at once", async () => {
    renderAt(CROWDED);
    await screen.findByTestId("t-more-filters");
    const shown = inlineIds();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(ALL_CONTROLS.length);
  });

  /**
   * A phone keeps ONE control, and that is the point of the re-spend: the bar
   * used to shed all six against the UNCOLLAPSED furniture (search 200 +
   * counter 96 + right 216), then collapse that furniture to 44 + 0 + 140 and
   * leave the freed ~330px as an empty band beside "Mais 6".
   *
   * Which one survives is whichever fits the room that is left, so a large
   * mobile keeps the cheaper "situacao" where a tablet affords "pagamento".
   */
  it.each([
    ["tablet", TABLET, ["pagamento"]],
    ["large mobile", LARGE_MOBILE, ["situacao"]],
  ])("keeps one control on the bar at %s", async (_name, width, expected) => {
    renderAt(width);
    await screen.findByTestId("t-more-filters");
    await waitFor(() => expect(inlineIds()).toEqual(expected));
  });

  it("still moves them all behind Mais at small mobile", async () => {
    // 320 is the floor we support, and there genuinely is no room for a pill
    // beside the magnifier, "Mais", the counter and the right-hand control.
    renderAt(SMALL_MOBILE);
    await screen.findByTestId("t-more-filters");
    expect(inlineIds()).toEqual([]);
  });
});

describe("an applied filter is ranked first, NOT exempt", () => {
  /**
   * The rule this replaced exempted applied filters from the overflow outright.
   * Four applied pills then claimed more width than a phone's row had, and the
   * bar painted past its own edge — the pills were reachable only by scrolling
   * the toolbar sideways.
   */
  it("still hides an applied filter on a small mobile", async () => {
    renderAt(SMALL_MOBILE);
    await screen.findByTestId("t-more-filters");
    await applyPagamento();
    await waitFor(() => expect(inlineIds()).toEqual([]));
  });

  it("ranks it ahead of an idle one where there IS a slot", async () => {
    renderAt(CROWDED);
    await screen.findByTestId("t-more-filters");
    await applyPagamento();
    await waitFor(() => expect(inlineIds()).toContain("pagamento"));
  });
});

describe("the Mais badge tells applied apart from merely hidden", () => {
  it("counts hidden FIELDS, in the neutral tone, while none is applied", async () => {
    renderAt(TABLET);
    const badge = await screen.findByTestId("t-more-badge");
    // One control now reaches the bar at this width, so five are behind it.
    const hidden = ALL_CONTROLS.length - 1;
    expect(badge).toHaveTextContent(String(hidden));
    expect(screen.getByTestId("t-more-filters")).toHaveAttribute(
      "aria-label",
      `Mais filtros: ${hidden} sem espaço na barra`,
    );
  });

  it("switches to counting the APPLIED ones once any is", async () => {
    // On a phone every filter is in there, so this badge is the only thing on
    // screen saying the list is filtered at all.
    renderAt(SMALL_MOBILE);
    await screen.findByTestId("t-more-filters");
    await applyPagamento();
    await waitFor(() =>
      expect(screen.getByTestId("t-more-filters")).toHaveAttribute(
        "aria-label",
        `Mais filtros: ${ALL_CONTROLS.length} sem espaço na barra, 1 aplicado(s)`,
      ),
    );
    expect(screen.getByTestId("t-more-badge")).toHaveTextContent("1");
  });
});

/* ── Search ──────────────────────────────────────────────────────────────── */

describe("the search box, and what expanding it costs", () => {
  it.each([
    ["tablet", TABLET],
    ["small desktop", SMALL_DESKTOP],
    ["large desktop", LARGE_DESKTOP],
  ])("keeps the box on the bar at %s", async (_name, width) => {
    renderAt(width);
    await waitFor(() => expect(has("t-search-all")).toBe(true));
    expect(has("t-search-all-collapsed")).toBe(false);
  });

  it.each([
    ["large mobile", LARGE_MOBILE],
    ["small mobile", SMALL_MOBILE],
  ])("collapses it to a magnifier at %s", async (_name, width) => {
    renderAt(width);
    await waitFor(() => expect(has("t-search-all-collapsed")).toBe(true));
  });

  /**
   * TAKEOVER vs SHRINK — two behaviours, and conflating them was the bug.
   *
   * A box expanded out of the magnifier drops its 200px floor and takes what
   * the cluster has. Only when what is left would be too narrow to read back do
   * the filters stand down and the box take the cluster outright.
   */
  it("shares the row on a large mobile — the filters stay", async () => {
    renderAt(LARGE_MOBILE);
    fireEvent.click(await screen.findByTestId("t-search-all-collapsed"));
    await waitFor(() => expect(has("t-search-all")).toBe(true));
    expect(has("t-more-filters")).toBe(true);
    expect(has("t-search-close")).toBe(false);
  });

  it("takes the whole cluster on a small mobile, with a way back out", async () => {
    renderAt(SMALL_MOBILE);
    fireEvent.click(await screen.findByTestId("t-search-all-collapsed"));
    await waitFor(() => expect(has("t-search-all")).toBe(true));
    expect(has("t-more-filters")).toBe(false);
    // A phone has no Escape key, so the takeover cannot be a one-way door.
    fireEvent.click(screen.getByTestId("t-search-close"));
    await waitFor(() => expect(has("t-more-filters")).toBe(true));
  });
});

/* ── Right-hand controls ─────────────────────────────────────────────────── */

describe("Exibir and Exportar shed their labels before the search suffers", () => {
  /**
   * A TABLET keeps them. With every filter already behind "Mais" the row has
   * room to spare there, and rung 2 is only taken when the search would
   * otherwise drop below its 200px floor — which is the point: the ladder
   * spends what it has rather than degrading on a schedule.
   */
  it.each([
    ["tablet", TABLET],
    ["small desktop", SMALL_DESKTOP],
    ["large desktop", LARGE_DESKTOP],
  ])("keeps the label at %s", async (_name, width) => {
    renderAt(width);
    const trigger = await screen.findByTestId("t-display-trigger");
    expect(trigger).toHaveTextContent("Exibir");
    // The label is present, so it names the control and needs no tooltip.
    expect(trigger).not.toHaveAttribute("title");
  });

  it.each([
    ["large mobile", LARGE_MOBILE],
    ["small mobile", SMALL_MOBILE],
  ])("drops to an icon with a tooltip at %s", async (_name, width) => {
    renderAt(width);
    const trigger = await screen.findByTestId("t-display-trigger");
    await waitFor(() => expect(trigger).toHaveAttribute("title", "Exibir"));
    expect(trigger).not.toHaveTextContent("Exibir");
  });
});

/* ── Clear all ───────────────────────────────────────────────────────────── */

describe("clearing every filter at once", () => {
  it("offers nothing to clear until something is applied", async () => {
    renderAt(LARGE_DESKTOP);
    await waitFor(() => {
      expect(inlineIds().length).toBeGreaterThan(0);
      expect(has("t-clear-all")).toBe(false);
    });
  });

  it("puts Limpar on the bar once a filter is applied, on a desktop", async () => {
    renderAt(LARGE_DESKTOP);
    await waitFor(() => expect(inlineIds()).toContain("pagamento"));
    await applyPagamento();
    const clear = await screen.findByTestId("t-clear-all");
    expect(clear).toHaveTextContent("Limpar");
    fireEvent.click(clear);
    await waitFor(() => expect(has("t-clear-all")).toBe(false));
  });

  /**
   * Rung 6. "Limpar" is the only control on this row with a second home, which
   * is why it goes before the magnifier or "Mais" — neither has anywhere to be.
   */
  it("takes it off the bar on a phone, leaving the panel footer to carry it", async () => {
    renderAt(SMALL_MOBILE);
    await screen.findByTestId("t-more-filters");
    await applyPagamento();
    await waitFor(() => expect(has("t-clear-all")).toBe(false));

    fireEvent.click(screen.getByTestId("t-more-filters"));
    await screen.findByTestId("t-more-panel");
    fireEvent.click(screen.getByTestId("t-more-clear-all"));
    await waitFor(() =>
      expect(screen.getByTestId("t-more-filters")).toHaveAttribute(
        "aria-label",
        `Mais filtros: ${ALL_CONTROLS.length} sem espaço na barra`,
      ),
    );
  });
});

/**
 * THE COUNT IS MEASURED, NOT A BREAKPOINT.
 *
 * "One filter on a large phone" is an OUTCOME of pricing this fixture against
 * that row — it is not a rule, and nothing in `data-views-overflow.ts` reads a
 * media query. That distinction is the whole reason the ladder measures:
 * pages declare different numbers of controls with different label lengths,
 * and the same page collapses at a different width in another language, so a
 * shared breakpoint is wrong for at least one table by construction.
 *
 * These pin it from both directions at ONE width, because a breakpoint would
 * give the same answer to all three.
 */
describe("what fits follows the controls, not the width alone", () => {
  const shortPills: FilterFieldConfig<Row>[] = [
    { id: "pagamento", label: "Pg", accessor: (row) => row.pagamento, options: [{ value: "pago", label: "Pago" }] },
    { id: "situacao", label: "St", accessor: (row) => row.situacao, options: [{ value: "aberto", label: "Aberto" }] },
  ];
  const longPills: FilterFieldConfig<Row>[] = [
    {
      id: "pagamento",
      label: "Situação do pagamento conciliada",
      accessor: (row) => row.pagamento,
      options: [{ value: "pago", label: "Pago" }],
    },
  ];

  it("keeps MORE on the same row when the table declares cheaper controls", async () => {
    renderAt(LARGE_MOBILE, { fields: shortPills, rangeFields: [] });
    await waitFor(() => expect(inlineIds()).toEqual(["pagamento", "situacao"]));
  });

  it("keeps FEWER on that same row when one control is long enough to fill it", async () => {
    renderAt(LARGE_MOBILE, { fields: longPills, rangeFields: [] });
    // One control, and it still does not fit — so the bar carries none, at a
    // width where two short ones both did.
    await screen.findByTestId("t-more-filters");
    expect(inlineIds()).toEqual([]);
  });

  it("promotes one more as the SAME table's row grows, without a breakpoint between", async () => {
    // 430 keeps one and 1024 keeps four (see the tables above); 900 sits
    // between them and keeps two. Nothing in the code names any of these.
    renderAt(900);
    await screen.findByTestId("t-more-filters");
    await waitFor(() => expect(inlineIds()).toEqual(["pagamento", "situacao"]));
  });
});
