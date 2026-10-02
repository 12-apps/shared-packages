/**
 * A CELL-CONFIGURED ROW, alone and on a phone; and the chevron that says a row
 * opens something.
 *
 * Three defects, each green in every test that existed:
 *
 *   1. Standalone, the row's template always carried the disclosure, drag and
 *      select tracks, but those gutters render NOTHING outside a group. Grid
 *      auto-placement then filled each empty track with the next slot, so every
 *      cell sat two tracks early: an amount in a 42px track read "R$ …".
 *   2. Below `STACK_BREAK` the two-line layout placed only the NAMED slots.
 *      Configured cells and the disclosure button were left to auto-placement,
 *      and inside a group the row spanned the named-slot rail count rather
 *      than the group's own.
 *   3. A row that opens a record had nothing saying so until a pointer hovered
 *      it — and a phone has no hover.
 *
 * jsdom does not evaluate container queries, so the stacked rules are checked
 * where they are built ({@link rowSx}); the template and the chevron are checked
 * on the rendered row.
 */
import { describe, expect, it } from "vitest";

import { render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { BaseListCard } from "../base-list-card";
import { rowSx } from "../base-list-card-geometry";
import { STACK_BREAK } from "../base-list-card-slots";
import type { ListCardCellConfig } from "../list-card-cells";
import { ListCardGroup } from "../list-card-rails";
import { rem } from "../../../../tokens/relative";
import { EN_US_DATA_VIEWS_COPY } from "../../../../en-US";
import { PT_BR_DATA_VIEWS_COPY } from "../../../../pt-BR";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  balance: string;
}

const ROW: Row = { id: "1", name: "Maria Aparecida dos Santos", balance: "R$ 190,00" };

const CELLS: readonly ListCardCellConfig<Row>[] = [
  { id: "who", primary: (row) => row.name },
  { id: "balance", primary: (row) => row.balance, align: "end", width: "max-content" },
];

const theme = createTheme();
const styleOf = (el: Element): CSSStyleDeclaration => getComputedStyle(el);

function renderRow(props: Partial<React.ComponentProps<typeof BaseListCard>>): void {
  render(
    <ThemeProvider theme={theme}>
      <BaseListCard row={ROW} cells={CELLS} testId="row" {...props} />
    </ThemeProvider>,
  );
}

describe("a standalone cell-configured row", () => {
  it("has no track for a gutter it does not render", () => {
    renderRow({});
    // leading, the two cells, the actions rail — nothing in front of them.
    expect(styleOf(screen.getByTestId("row")).gridTemplateColumns).toBe("auto minmax(0, 1fr) max-content auto");
  });

  it("keeps the select track when the row is selectable, and only that one", () => {
    renderRow({ onToggleSelect: () => {} });
    expect(styleOf(screen.getByTestId("row")).gridTemplateColumns).toBe(
      "auto auto minmax(0, 1fr) max-content auto",
    );
  });

  it("keeps the disclosure track when the row has a body to reveal", () => {
    renderRow({ onToggleSelect: () => {}, children: <span>detalhes</span> });
    expect(styleOf(screen.getByTestId("row")).gridTemplateColumns).toBe(
      "auto auto auto minmax(0, 1fr) max-content auto",
    );
  });
});

describe("a standalone row's query container", () => {
  /**
   * The rules emotion injected for an element's own classes. jsdom does not
   * compute `container-type`, but it holds the rule text the browser applies.
   * Tied to emotion writing each class as a top-level `.<class>{…}` rule: if
   * that ever changes, this fails loudly (no rule found), never silently.
   */
  const ownRules = (el: Element): string => {
    const css = [...document.querySelectorAll("style")].map((tag) => tag.textContent ?? "").join("\n");
    return [...el.classList]
      .map((cls) => new RegExp(`(^|\\})\\.${cls}\\{([^}]*)\\}`).exec(css)?.[2] ?? "")
      .join(";");
  };

  it("is a wrapper around the row, never the row itself", () => {
    // A container query matches an ANCESTOR, never the element itself: a row
    // that was its own container placed its children for two lines while its
    // own template stayed wide.
    renderRow({});
    const row = screen.getByTestId("row");
    expect(ownRules(row.parentElement!)).toContain("container-type:inline-size");
    expect(ownRules(row)).not.toContain("container-type");
  });

  it("is absent inside a group, where the row must stay the group's direct child", () => {
    render(
      <ThemeProvider theme={theme}>
        <ListCardGroup cells={CELLS} dataTestId="group">
          <BaseListCard row={ROW} testId="row" />
        </ListCardGroup>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("row").parentElement).toBe(screen.getByTestId("group"));
  });
});

describe("the stacked row, below STACK_BREAK", () => {
  const base = {
    inGroup: true,
    railCount: 7,
    cellTemplate: null,
    compactTemplate: null,
    gutters: { disclose: true, drag: true, select: true },
    metaColumns: 0,
    pad: 1,
    padY: 1,
    scale: 1,
    divider: false,
    interactive: true,
    draggable: false,
  };
  const stacked = (stack: { firstCell: string | null; valueCell?: string | null; expandable: boolean }): Record<string, unknown> =>
    rowSx(theme, { ...base, stack: { valueCell: null, ...stack } })[`@container (max-width: ${rem(theme, STACK_BREAK)})`] as Record<string, unknown>;

  it("spans the group's own track count, not the named-slot one", () => {
    expect(stacked({ firstCell: "who", expandable: false }).gridColumn).toBe("span 7");
  });

  it("keeps the first cell in the title's place and the value cell under it, and hides the rest", () => {
    const rules = stacked({ firstCell: "who", valueCell: "balance", expandable: false });
    expect(rules['& > [data-slot^="cell-"]']).toEqual({ display: "none" });
    expect(rules['& > [data-slot="cell-who"]']).toEqual({ display: "flex", gridArea: "1 / 3" });
    expect(rules['& > [data-slot="cell-balance"]']).toEqual({ display: "flex", gridArea: "2 / 3 / 3 / 5" });
    // The named cells' rules must come AFTER the hide-all one: same
    // specificity, so order decides, and the reverse would hide them too.
    const keys = Object.keys(rules);
    const hideAll = keys.indexOf('& > [data-slot^="cell-"]');
    expect(keys.indexOf('& > [data-slot="cell-who"]')).toBeGreaterThan(hideAll);
    expect(keys.indexOf('& > [data-slot="cell-balance"]')).toBeGreaterThan(hideAll);
  });

  it("places the disclosure button under the checkbox, or nowhere when it is only a reserved gutter", () => {
    expect(stacked({ firstCell: "who", expandable: true })['& > [data-slot="disclose"]']).toEqual({
      gridArea: "2 / 1",
      justifySelf: "center",
    });
    expect(stacked({ firstCell: "who", expandable: false })['& > [data-slot="disclose"]']).toEqual({ display: "none" });
  });

  it("adds no cell rules to a named-slot row", () => {
    const rules = stacked({ firstCell: null, expandable: false });
    expect(Object.keys(rules).some((key) => key.includes("cell-"))).toBe(false);
  });
});

describe("the chevron on a row that opens something", () => {
  it("ends a clickable row", () => {
    renderRow({ onClick: () => {} });
    expect(screen.getByTestId("row-open")).toHaveAttribute("aria-hidden");
  });

  it("is absent from a named-slot row with an href and no title: no anchor is rendered", async () => {
    render(
      <ThemeProvider theme={theme}>
        <BaseListCard subtitle="sem título" href="/pedidos/1" testId="row" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("row")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("row-open")).toBeNull());
  });

  it("ends a named-slot row that links", () => {
    render(
      <ThemeProvider theme={theme}>
        <BaseListCard title="Pedido 1" href="/pedidos/1" testId="row" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("row-open")).toBeInTheDocument();
  });

  it("is absent from a configured row given only an href: it renders no link to follow", async () => {
    renderRow({ href: "/pedidos/1" });
    expect(screen.getByTestId("row")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("row-open")).toBeNull());
  });

  it("is absent from a row that expands: its disclosure chevron already speaks", async () => {
    renderRow({ onClick: () => {}, children: <span>detalhes</span> });
    expect(screen.getByTestId("row-disclose")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("row-open")).toBeNull());
  });

  it("is absent from a row that does nothing", async () => {
    renderRow({});
    await waitFor(() => expect(screen.queryByTestId("row-open")).toBeNull());
  });

  it("is absent from a disabled row even when it has a click handler", async () => {
    renderRow({ onClick: () => {}, state: "disabled" });
    await waitFor(() => expect(screen.queryByTestId("row-open")).toBeNull());
  });
});

describe("which cell stands in for the value when the row stacks", () => {
  /**
   * The id whose stacked rule puts it on line 2, read from the CSS emotion
   * actually injected — jsdom cannot evaluate the container query, but it does
   * hold the rule text the browser would.
   */
  const stackedValueOf = (cells: readonly ListCardCellConfig<Row>[]): string | null => {
    render(
      <ThemeProvider theme={theme}>
        <BaseListCard row={ROW} cells={cells} testId="row" />
      </ThemeProvider>,
    );
    const css = [...document.querySelectorAll("style")].map((tag) => tag.textContent ?? "").join("\n");
    // Emotion's tags outlive each test's DOM, so match THIS row's own class only.
    for (const cls of screen.getByTestId("row").classList) {
      const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`\\.${escaped}>\\[data-slot="cell-([\\w-]+)"\\]\\{[^}]*grid-area:2/3/3/5;`).exec(css);
      if (match) return match[1] ?? null;
    }
    return null;
  };

  const who = (): ListCardCellConfig<Row> => ({ id: "who", primary: (row) => row.name });
  const balance = (): ListCardCellConfig<Row> => ({ id: "balance", primary: (row) => row.balance, align: "end" });

  it("is the last cell by default", () => {
    expect(stackedValueOf([who(), { id: "note", primary: () => "nota" }, balance()])).toBe("balance");
  });

  it("is the strong cell when the config marks one", () => {
    expect(stackedValueOf([who(), { id: "total", primary: () => "R$ 9", strong: true }, balance()])).toBe("total");
  });

  it("is the last cell when only the first is strong: the first already holds the title's place", () => {
    expect(stackedValueOf([{ ...who(), strong: true }, { id: "note", primary: () => "nota" }, balance()])).toBe("balance");
  });

  it("is the first strong cell after the title when every cell is strong", () => {
    const strong = (cell: ListCardCellConfig<Row>): ListCardCellConfig<Row> => ({ ...cell, strong: true });
    expect(stackedValueOf([strong(who()), strong({ id: "total", primary: () => "R$ 9" }), strong(balance())])).toBe("total");
  });

  it("is none for a one-cell row: the first cell already holds the title's place", () => {
    expect(stackedValueOf([who()])).toBeNull();
  });
});

describe("the selection count's words", () => {
  it("agree with the number in both packs", () => {
    expect(PT_BR_DATA_VIEWS_COPY.selection.selectedCount(1)).toBe("1 selecionado");
    expect(PT_BR_DATA_VIEWS_COPY.selection.selectedCount(3)).toBe("3 selecionados");
    expect(EN_US_DATA_VIEWS_COPY.selection.selectedCount(1)).toBe("1 item selected");
    expect(EN_US_DATA_VIEWS_COPY.selection.selectedCount(3)).toBe("3 items selected");
  });
});
