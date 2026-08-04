/**
 * The pieces every entity fetcher shares (FUT-454), split out of `adapter.ts`
 * so the kitchen fetchers can live in their own module without importing the
 * module that registers them — a cycle the registration table would otherwise
 * force.
 */

export interface ReportWindow {
  from: Date;
  toExclusive: Date;
}

export interface DateWindowWhere {
  gte: Date;
  lt: Date;
}

export type SourceRow = Record<string, unknown>;

/** The half-open `[from, toExclusive)` window, as a Prisma date filter. */
export function windowWhere(window: ReportWindow): DateWindowWhere {
  return { gte: window.from, lt: window.toExclusive };
}
