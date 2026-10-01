import { describe, expect, it } from "vitest";

import { CHART_BOX_SX } from "../lib/render-sx";

/**
 * The chart's own 16px padding came out of the plot on a phone, so the chart
 * box removes it (FUT-3167) — but the hover tooltip is a Paper drawn inside the
 * chart as well, and it must keep the padding around the amount it shows.
 */
describe("CHART_BOX_SX — padding", () => {
  it("removes the padding from the chart's own paper only", () => {
    expect(CHART_BOX_SX["& > .MuiPaper-root"]).toEqual({ padding: 0 });
  });

  it("leaves every nested paper, the tooltip included, its padding", () => {
    expect(CHART_BOX_SX["& .MuiPaper-root"]).not.toHaveProperty("padding");
  });
});
