/**
 * A KPI block's figures, whatever age the payload is (FUT-755).
 *
 * `Número` takes one or more measures now, so a KPI render carries a `figures`
 * array. A response produced before that field existed — a cached one, or a
 * host still on the previous version — carries its single figure spread across
 * the render's own `label` / `value` / `suppressed` / `format`, which is
 * precisely what those fields meant. So the fallback is not a degradation: it
 * is the same tile, reassembled.
 *
 * It lives here rather than beside the type because `reports-api.ts` is the
 * range work's file this cycle, and this helper has nothing to do with periods.
 */
import type { ReportRender } from "../reports-api";

type KpiRender = Extract<ReportRender, { kind: "kpi" }>;

/** One labelled number inside a KPI block. */
export type ReportKpiFigure = NonNullable<KpiRender["figures"]>[number];

/** How a KPI figure is printed. */
export type ReportKpiFormat = KpiRender["format"];

export function kpiFigures(render: KpiRender): ReportKpiFigure[] {
  if (render.figures !== undefined && render.figures.length > 0) return render.figures;
  return [
    {
      label: render.label,
      value: render.value,
      suppressed: render.suppressed,
      format: render.format,
    },
  ];
}
