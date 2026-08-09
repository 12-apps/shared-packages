import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { renderReport } from '../render';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { orderRows, salesCatalog } from './fixtures';

/**
 * Two chart decisions the visual pass turned into rules (FUT-755), pinned at
 * the seam that makes them: `renderReport` is what hands `@12-apps/ui` its
 * ChartSpec, so it is where "no legend on a single series" and "integer ticks
 * for a count" are either true or not.
 *
 * Both were verified in a browser first. Neither is provable by reading the
 * chart component alone, because both are decided here and merely obeyed
 * there.
 */

function chartSpecFor(input: ReportSpecInput) {
  const spec = reportSpecSchema.parse(input);
  const query = compileReport(spec, salesCatalog);
  const model = renderReport(query, spec.presentation, salesCatalog, orderRows);
  if (model.kind !== 'chart') throw new Error(`Expected a chart model, got "${model.kind}".`);
  return model.chartSpec;
}

const BAR_BY_METHOD: ReportSpecInput = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'chart', chartType: 'bar' },
};

describe('renderReport — chart legend', () => {
  it('omits the legend for a single series', () => {
    // The one series is already named by the block title and by the spec
    // sentence directly above the chart. A third copy costs a row of height
    // to say nothing new.
    expect(chartSpecFor(BAR_BY_METHOD).legend).toBe(false);
  });

  it('keeps the legend once there is more than one series', () => {
    const chartSpec = chartSpecFor({
      ...BAR_BY_METHOD,
      measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
    });

    expect(chartSpec.legend).toBe(true);
  });
});

describe('renderReport — number format drives the tick scale', () => {
  it('marks a count as integer, so the axis cannot offer half-steps', () => {
    // Recharts spaces ticks evenly across the domain. A count topping out at 2
    // gets 0/0.5/1/1.5/2, which an integer formatter then renders as
    // `0, 1, 1, 2, 2` — an axis that reads as though it repeats itself. The
    // format is what tells the chart to place whole-numbered ticks instead, so
    // formatting alone could never have fixed it.
    expect(chartSpecFor({ ...BAR_BY_METHOD, measures: [{ field: 'itemCount', aggregation: 'count' }] }).numberFormat).toBe('integer');
  });

  it('leaves a money measure on its own format', () => {
    expect(chartSpecFor(BAR_BY_METHOD).numberFormat).toBe('brl');
  });
});
