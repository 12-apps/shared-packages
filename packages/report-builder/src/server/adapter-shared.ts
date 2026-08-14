/**
 * The reporting WINDOW, and the database filter a host adapter applies it with.
 *
 * What is left of a module that used to sit under this package's own Prisma
 * adapters — those are the host's now, because an adapter is a set of reads
 * against one application's tables. The window is not: it is resolved by the
 * period this surface owns, handed to the host's adapter factory, and echoed on
 * every response, so the two ends have to agree about what `[from,
 * toExclusive)` means.
 */

export interface ReportWindow {
  from: Date;
  toExclusive: Date;
}

export interface DateWindowWhere {
  gte: Date;
  lt: Date;
}

/** The half-open `[from, toExclusive)` window, as a Prisma date filter. */
export function windowWhere(window: ReportWindow): DateWindowWhere {
  return { gte: window.from, lt: window.toExclusive };
}
