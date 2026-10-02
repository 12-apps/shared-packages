import { createTheme, ThemeProvider } from "@mui/material/styles/index.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";

import { Box } from "../../../mui/Box";
import { PT_BR_DATA_VIEWS_COPY } from "../../../pt-BR";
import { BaseListCard } from "./base-list-card";
import { DataViewsCopyProvider } from "./data-views-copy-context";
import type { ListCardCellConfig } from "./list-card-cells";
import { cellRailCount, ListCardGroup } from "./list-card-rails";

/**
 * THE GROUP'S TRACKS, MEASURED IN A BROWSER (FUT-3221).
 *
 * jsdom evaluates neither container queries nor `:has()`, so the unit tests
 * can only read the rules `list-card-group-tracks` builds. These stories read
 * what Chromium makes of them: how many tracks the grid resolved, how wide the
 * first cell came out, and whether each cell landed in its own column.
 *
 *   - A reserving group in the compact band (a 560px list) drops the drag track
 *     no row fills, halves the gap, and gives the first cell a double share.
 *   - The same group at 900px is laid out as before: every gutter, full gap.
 *   - `reserveGutters={false}` drops each gutter no row uses, keeps one any row
 *     uses, and every row's cells line up in the same columns.
 */

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  when: string;
  total: string;
}

const ROWS: Row[] = [
  { id: "1", name: "Sabonete Líquido Erva-Doce", when: "01/10/2026", total: "R$ 16,00" },
  { id: "2", name: "Amendoim Japonês 150g", when: "30/09/2026", total: "R$ 7,50" },
];

const CELLS: readonly ListCardCellConfig<Row>[] = [
  { id: "who", primary: (row) => row.name },
  { id: "when", primary: (row) => row.when },
  { id: "status", primary: () => "Pago" },
  { id: "total", primary: (row) => row.total, align: "end", width: "max-content" },
];

const RAILS = cellRailCount(CELLS.length);
const theme = createTheme();

function Frame({ width, children }: { width: number; children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <DataViewsCopyProvider copy={PT_BR_DATA_VIEWS_COPY}>
        <Box sx={{ width }}>{children}</Box>
      </DataViewsCopyProvider>
    </ThemeProvider>
  );
}

/** The resolved track count of a group's grid. */
function trackCount(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
}

/** Each row's cells' left edges, in config order. */
function cellLefts(grid: HTMLElement): number[][] {
  return [...grid.children].map((row) =>
    [...row.querySelectorAll(':scope > [data-slot^="cell-"]')].map((cell) => Math.round(cell.getBoundingClientRect().left)),
  );
}

const meta: Meta = {
  title: "Dashboards/DataViewsTable/Tests",
  parameters: { layout: "padded" },
  tags: ["test", "component:DataViews"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const CompactBandDropsTheEmptyDragTrack: Story = {
  name: "Test: a list in the compact band drops the empty drag track and widens the name",
  render: () => (
    <Frame width={560}>
      <ListCardGroup cells={CELLS as readonly ListCardCellConfig<never>[]} dataTestId="band">
        {ROWS.map((row) => (
          <BaseListCard key={row.id} row={row} testId={`band-${row.id}`} onToggleSelect={() => {}} />
        ))}
      </ListCardGroup>
    </Frame>
  ),
  play: async ({ canvasElement, step }) => {
    const grid = within(canvasElement).getByTestId("band");
    await step("One track fewer: the drag gutter no row fills is gone", async () => {
      await expect(trackCount(grid)).toBe(RAILS - 1);
    });
    await step("The gap is halved and the name takes a double share", async () => {
      const row = within(canvasElement).getByTestId("band-1");
      await expect(getComputedStyle(row).columnGap).toBe("12px");
      // The GRID's tracks, not the cells' boxes: a subgrid applies its own gap
      // as a margin on each item, so a cell is its track less the gap. With
      // drag gone the tracks read disclose, select, leading, then the cells.
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map((track) => parseFloat(track));
      const [who = 0, when = 0] = tracks.slice(3, 5);
      // Within a pixel: the two shares round separately.
      await expect(Math.abs(who - when * 2)).toBeLessThanOrEqual(1);
    });
  },
};

export const WideListKeepsEveryGutter: Story = {
  name: "Test: a list wider than the band keeps every gutter and the full gap",
  render: () => (
    <Frame width={900}>
      <ListCardGroup cells={CELLS as readonly ListCardCellConfig<never>[]} dataTestId="wide">
        {ROWS.map((row) => (
          <BaseListCard key={row.id} row={row} testId={`wide-${row.id}`} onToggleSelect={() => {}} />
        ))}
      </ListCardGroup>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const grid = within(canvasElement).getByTestId("wide");
    await expect(trackCount(grid)).toBe(RAILS);
    await expect(getComputedStyle(within(canvasElement).getByTestId("wide-1")).columnGap).toBe("24px");
  },
};

/** Both rows select; only the first expands; neither drags. */
function UnreservedList({ width, testId }: { width: number; testId: string }) {
  return (
    <Frame width={width}>
      <ListCardGroup cells={CELLS as readonly ListCardCellConfig<never>[]} reserveGutters={false} dataTestId={testId}>
        <BaseListCard row={ROWS[0]} testId={`${testId}-1`} onToggleSelect={() => {}}>
          <span>detalhes</span>
        </BaseListCard>
        <BaseListCard row={ROWS[1]} testId={`${testId}-2`} onToggleSelect={() => {}} />
      </ListCardGroup>
    </Frame>
  );
}

/** The tracks follow the rows: disclose and select stay, drag goes, cells line up. */
async function expectTracksFollowRows(canvasElement: HTMLElement, testId: string): Promise<void> {
  const grid = within(canvasElement).getByTestId(testId);
  // Disclose and select keep their tracks; drag, which no row uses, has none.
  await expect(trackCount(grid)).toBe(RAILS - 1);
  // Every row's cells sit in the same columns, left to right.
  const [first, second] = cellLefts(grid);
  await expect(first).toEqual(second);
  await expect([...(first ?? [])].sort((a, b) => a - b)).toEqual(first);
  // The first cell starts after the select gutter, not in it.
  const row = within(canvasElement).getByTestId(`${testId}-2`);
  const select = row.querySelector(':scope > [data-slot="select"]')?.getBoundingClientRect();
  const who = row.querySelector(':scope > [data-slot="cell-who"]')?.getBoundingClientRect();
  await expect((who?.left ?? 0) > (select?.right ?? Infinity)).toBe(true);
}

export const UnreservedGuttersFollowTheRows: Story = {
  name: "Test: reserveGutters={false} keeps a track only for a gutter some row uses",
  render: () => <UnreservedList width={900} testId="free" />,
  play: async ({ canvasElement }) => expectTracksFollowRows(canvasElement, "free"),
};

export const UnreservedGuttersInTheBand: Story = {
  name: "Test: reserveGutters={false} answers the compact band the same way",
  render: () => <UnreservedList width={560} testId="free-band" />,
  play: async ({ canvasElement }) => expectTracksFollowRows(canvasElement, "free-band"),
};
