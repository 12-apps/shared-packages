import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { PT_BR_DATA_VIEWS_COPY } from "../../../pt-BR";
import { Box } from "../../../mui/Box";
import { DataViewsCopyProvider } from "./data-views-copy-context";
import { RangePill } from "./data-views-range-pill";
import type { RangeFieldConfig, RangeValue } from "./data-views-types";

/**
 * THE RANGE CALENDAR IN A DAY FILTER'S POPOVER (FUT-4144, option B).
 *
 * The owner picked a calendar that is always open under the typed `De`/`Até`
 * boxes: a period is three taps (open the filter, the first day, the last day)
 * and typing is as short as it was. These run in a real browser, where the
 * jsdom cases in `range-calendar.test.tsx` cannot see layout.
 */

interface Row extends Record<string, unknown> {
  day: string;
}

const PERIOD: RangeFieldConfig<Row> = {
  id: "period",
  label: "Data",
  kind: "day",
  accessor: (row) => row.day,
};

const TEST_ID = "pedidos-range-period";

/** The pill in a toolbar row, holding its range as the grid's state does. */
function Harness({ initial = {} }: { initial?: RangeValue }) {
  const [value, setValue] = useState<RangeValue>(initial);
  return (
    <DataViewsCopyProvider copy={PT_BR_DATA_VIEWS_COPY}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
        <RangePill field={PERIOD} value={value} onChange={setValue} testIdPrefix="pedidos" />
      </Box>
    </DataViewsCopyProvider>
  );
}

const meta = {
  title: "Dashboards/DataViewsTable/RangeCalendar/Tests",
  component: Harness,
  tags: ["test", "component:DataViews"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Harness>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The popover portals to `document.body`, not into the canvas. */
const body = () => within(document.body);

async function openFilter(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  await userEvent.click(within(canvasElement).getByTestId(TEST_ID));
  const calendar = await body().findByTestId(`${TEST_ID}-calendar`);
  return within(calendar);
}

/** Closed: the pill alone, as the toolbar shows it. */
export const Closed: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId(TEST_ID)).toHaveTextContent("Data");
  },
};

/**
 * Open the filter, tap the 1st, tap the 15th: both boxes are written. It
 * starts on a fixed period so the month on screen does not follow the clock;
 * a whole period on screen means the next tap starts a new one.
 */
export const PicksAPeriodInThreeTaps: Story = {
  args: { initial: { min: "2026-10-20", max: "2026-10-22" } },
  play: async ({ canvasElement }) => {
    const calendar = await openFilter(canvasElement);
    // The hint's line says the applied window while one is set (FUT-4144
    // follow-up: the summary moved onto this line), and the step once the
    // first tap starts a new period.
    await expect(body().getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent("Data: 20/10–22/10");

    await userEvent.click(calendar.getByRole("gridcell", { name: "1 de outubro de 2026" }));
    await expect(body().getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent("Agora toque no último dia.");
    await userEvent.click(calendar.getByRole("gridcell", { name: "15 de outubro de 2026" }));

    await waitFor(() => expect(body().getByTestId(`${TEST_ID}-min`)).toHaveValue("01/10/2026"));
    await expect(body().getByTestId(`${TEST_ID}-max`)).toHaveValue("15/10/2026");
    await expect(body().getByTestId(`${TEST_ID}-calendar-hint`)).toHaveTextContent("Data: 01/10–15/10");
  },
};

/** A typed day moves the calendar to its month and marks it. */
export const TypedDayMovesTheCalendar: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const calendar = await openFilter(canvasElement);

    await userEvent.type(body().getByTestId(`${TEST_ID}-min`), "05112026");

    await waitFor(() => expect(calendar.getByRole("grid", { name: "novembro de 2026" })).toBeVisible());
    await expect(calendar.getByRole("gridcell", { name: "5 de novembro de 2026" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};

/** An impossible typed day is refused in its box and the calendar stays where it was. */
export const ImpossibleDayLeavesTheCalendar: Story = {
  args: { initial: { min: "2026-10-01", max: "2026-10-15" } },
  play: async ({ canvasElement }) => {
    const calendar = await openFilter(canvasElement);
    const from = body().getByTestId(`${TEST_ID}-min`);

    await userEvent.clear(from);
    await userEvent.type(from, "31022026");

    await waitFor(() => expect(from).toHaveAttribute("aria-invalid", "true"));
    await expect(calendar.getByRole("grid", { name: "outubro de 2026" })).toBeVisible();
    await expect(calendar.getByRole("gridcell", { name: "15 de outubro de 2026" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
};
