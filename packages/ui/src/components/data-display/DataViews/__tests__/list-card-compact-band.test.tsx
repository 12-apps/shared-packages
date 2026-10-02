/**
 * THE COMPACT BAND, `reserveGutters={false}`, AND THE EXPORT PANEL'S SCOPE LINE.
 *
 * Three follow-ups to FUT-3184, each green in every test that existed:
 *
 *   1. Between `STACK_BREAK` and 600px a configured row stayed one line of
 *      columns at full spacing: eight 24px rail gaps, a reserved drag track no
 *      row filled, and the name in an even share — "Sab…" on Produtos, "Ana
 *      Loj…" on Pedidos.
 *   2. A group with `reserveGutters={false}` kept all three gutter tracks while
 *      its rows rendered nothing in the empty ones, so every cell auto-flowed
 *      into the track before its own.
 *   3. The export panel's scope line was a pt-BR literal an en-US host could
 *      not replace.
 *
 * jsdom evaluates neither container queries nor `:has()`, so the rules are
 * checked where they are built; the DOM shape they rely on is checked on the
 * rendered group. The rules themselves were driven in Chromium.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { BaseListCard } from "../base-list-card";
import { rowSx } from "../base-list-card-geometry";
import { COMPACT_BREAK, STACK_BREAK } from "../base-list-card-slots";
import { compactCellTracks, type ListCardCellConfig } from "../list-card-cells";
import { groupTracksSx, type GroupTemplate } from "../list-card-group-tracks";
import { ListCardGroup, RAIL_GAP } from "../list-card-rails";
import { rem } from "../../../../tokens/relative";
import { EN_US_DATA_VIEWS_COPY } from "../../../../en-US";
import { PT_BR_DATA_VIEWS_COPY } from "../../../../pt-BR";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  total: string;
}

const ROW: Row = { id: "1", name: "Sabonete Líquido Erva-Doce", total: "R$ 16,00" };

/** A fresh config per use, so no test can reach another's. */
const cellsOf = (): readonly ListCardCellConfig<Row>[] => [
  { id: "who", primary: (row) => row.name },
  { id: "when", primary: () => "01/10/2026" },
  { id: "total", primary: (row) => row.total, align: "end", width: "max-content" },
];

const theme = createTheme();
const COMPACT = `@container (max-width: ${rem(theme, COMPACT_BREAK)})`;
const STACKED = `@container (max-width: ${rem(theme, STACK_BREAK)})`;
const DRAG_EMPTY = '&:not(:has(> * > [data-slot="drag"] > *))';

/** A template that spells out which gutters it kept, so a rule can be read. */
const spelled: GroupTemplate = (dropped, compact) =>
  [
    ...(["disclose", "drag", "select"] as const).filter((gutter) => !dropped.has(gutter)),
    compact ? "compact" : "wide",
  ].join(" ");

describe("the first cell in the compact band", () => {
  it("takes a double share when it left its width to the list", () => {
    expect(compactCellTracks(cellsOf() as readonly ListCardCellConfig<never>[])).toEqual([
      "minmax(0, 2fr)",
      "minmax(0, 1fr)",
      "max-content",
    ]);
  });

  it("keeps a width it declared", () => {
    const [first, ...rest] = cellsOf();
    const own = [{ ...first, width: "12rem" }, ...rest] as readonly ListCardCellConfig<never>[];
    expect(compactCellTracks(own)[0]).toBe("12rem");
  });
});

describe("a reserving group's tracks", () => {
  const sx = groupTracksSx(theme, { template: spelled, railCount: 8, reserveGutters: true });

  it("keeps every gutter at full width, with no rule to drop one", () => {
    expect(sx.gridTemplateColumns).toBe("disclose drag select wide");
    expect(Object.keys(sx).filter((key) => key.startsWith("&"))).toEqual([]);
  });

  it("drops only the drag track in the compact band, and only when no row drags", () => {
    const band = sx[COMPACT] as Record<string, Record<string, unknown>>;
    expect(band.gridTemplateColumns).toBe("disclose drag select compact");
    expect(Object.keys(band).filter((key) => key.startsWith("&"))).toEqual([DRAG_EMPTY]);
    expect(band[DRAG_EMPTY]).toEqual({
      gridTemplateColumns: "disclose select compact",
      "& > *": { gridColumn: "span 7" },
      '& > * > [data-slot="drag"]': { display: "none" },
    });
  });
});

describe("a group that does not reserve its gutters", () => {
  const sx = groupTracksSx(theme, { template: spelled, railCount: 8, reserveGutters: false }) as Record<
    string,
    Record<string, unknown>
  >;
  const rules = Object.keys(sx).filter((key) => key.startsWith("&"));

  it("has one rule per combination of empty gutters, each naming all three", () => {
    expect(rules).toHaveLength(7);
    for (const rule of rules) expect(rule.match(/:has\(/g)).toHaveLength(3);
  });

  it("drops exactly the tracks no row fills, and every row spans what is left", () => {
    const rule = '&:has(> * > [data-slot="disclose"] > *):not(:has(> * > [data-slot="drag"] > *)):not(:has(> * > [data-slot="select"] > *))';
    expect(sx[rule]).toEqual({
      gridTemplateColumns: "disclose wide",
      "& > *": { gridColumn: "span 6" },
      '& > * > [data-slot="drag"]': { display: "none" },
      '& > * > [data-slot="select"]': { display: "none" },
    });
  });

  it("keeps a gutter's track when any row fills it", () => {
    const allFilled = '&:has(> * > [data-slot="disclose"] > *):has(> * > [data-slot="drag"] > *):has(> * > [data-slot="select"] > *)';
    // No rule for "nothing empty": the base template already keeps all three.
    expect(rules).not.toContain(allFilled);
    expect(sx.gridTemplateColumns).toBe("disclose drag select wide");
  });

  it("answers the compact band the same way, with the compact template", () => {
    const band = sx[COMPACT] as Record<string, Record<string, unknown>>;
    expect(Object.keys(band).filter((key) => key.startsWith("&"))).toHaveLength(7);
    expect(band.gridTemplateColumns).toBe("disclose drag select compact");
  });
});

describe("the rendered group", () => {
  it("is a container around the grid, and the rows stay the grid's direct children", () => {
    render(
      <ThemeProvider theme={theme}>
        <ListCardGroup cells={cellsOf()} dataTestId="group">
          <BaseListCard row={ROW} testId="row" />
        </ListCardGroup>
      </ThemeProvider>,
    );
    const grid = screen.getByTestId("group");
    expect(screen.getByTestId("row").parentElement).toBe(grid);
    expect(getComputedStyle(grid).display).toBe("grid");
    // jsdom does not compute `container-type`, but it holds the rule text the
    // browser applies: the wrapper is the container, the grid is not.
    const css = [...document.querySelectorAll("style")].map((tag) => tag.textContent ?? "").join("\n");
    const own = (el: Element): string =>
      [...el.classList].map((cls) => new RegExp(`(^|\\})\\.${cls}\\{([^}]*)\\}`).exec(css)?.[2] ?? "").join(";");
    expect(own(grid.parentElement as Element)).toContain("container-type:inline-size");
    expect(own(grid)).not.toContain("container-type");
  });

  it("renders every gutter slot in a non-reserving group, empty when the row does not use it", () => {
    render(
      <ThemeProvider theme={theme}>
        <ListCardGroup cells={cellsOf()} reserveGutters={false} dataTestId="group">
          <BaseListCard row={ROW} testId="row" onToggleSelect={() => {}} />
        </ListCardGroup>
      </ThemeProvider>,
    );
    const row = screen.getByTestId("row");
    const slot = (name: string): Element | null => row.querySelector(`:scope > [data-slot="${name}"]`);
    // The group asks whether any row's slot has CONTENT; an absent slot would
    // leave nothing to hide and shift every later slot one track left.
    expect(slot("disclose")?.childElementCount).toBe(0);
    expect(slot("drag")?.childElementCount).toBe(0);
    expect(slot("select")?.childElementCount).toBeGreaterThan(0);
  });
});

describe("the row in the compact band", () => {
  const base = {
    railCount: 7,
    cellTemplate: "auto minmax(0, 1fr) max-content auto",
    gutters: { disclose: false, drag: false, select: false },
    metaColumns: 0,
    pad: 1,
    padY: 1,
    scale: 1,
    divider: false,
    interactive: false,
    draggable: false,
    stack: { firstCell: "who", valueCell: "total", expandable: false },
  };

  it("halves the rail gap, and a standalone row takes its compact template", () => {
    const sx = rowSx(theme, { ...base, inGroup: false, compactTemplate: "auto minmax(0, 2fr) max-content auto" });
    expect(sx[COMPACT]).toEqual({ columnGap: RAIL_GAP / 2, gridTemplateColumns: "auto minmax(0, 2fr) max-content auto" });
  });

  it("leaves the template to the group inside one", () => {
    const sx = rowSx(theme, { ...base, inGroup: true, compactTemplate: null });
    expect(sx[COMPACT]).toEqual({ columnGap: RAIL_GAP / 2 });
  });

  it("comes before the two-line rule, which must win below STACK_BREAK", () => {
    const keys = Object.keys(rowSx(theme, { ...base, inGroup: true, compactTemplate: null }));
    expect(keys.indexOf(COMPACT)).toBeLessThan(keys.indexOf(STACKED));
  });
});

describe("the export panel's scope line", () => {
  it("reads the host's words in both packs", () => {
    expect(PT_BR_DATA_VIEWS_COPY.export.scopeLine(0, 214)).toBe("Exportando 214 itens filtrados");
    expect(PT_BR_DATA_VIEWS_COPY.export.scopeLine(0, 1)).toBe("Exportando 1 item filtrado");
    expect(PT_BR_DATA_VIEWS_COPY.export.scopeLine(3, 214)).toBe("Exportando 3 itens selecionados");
    expect(PT_BR_DATA_VIEWS_COPY.export.scopeLine(1, 214)).toBe("Exportando 1 item selecionado");
    expect(EN_US_DATA_VIEWS_COPY.export.scopeLine(0, 214)).toBe("Exporting 214 filtered items");
    expect(EN_US_DATA_VIEWS_COPY.export.scopeLine(0, 1)).toBe("Exporting 1 filtered item");
    expect(EN_US_DATA_VIEWS_COPY.export.scopeLine(3, 214)).toBe("Exporting 3 selected items");
    expect(EN_US_DATA_VIEWS_COPY.export.scopeLine(1, 214)).toBe("Exporting 1 selected item");
  });
});
