import { compileReport, reportSpecSchema, type FieldCatalog } from "../../index";
import { describe, expect, it } from "vitest";

import { createTenantReportDataSource, type ReportSourceDb } from "../adapter";
import { REPORT_ENTITY_DATE_FIELD, reportCatalog } from "../catalog";

/**
 * `REPORT_ENTITY_DATE_FIELD` says which column each entity's report window is
 * applied to. Nothing in production reads it — it is documentation that looks
 * like code, and documentation that can silently disagree with the fetcher is
 * the wrong-column trap: flip `kitchen_ticket_items` from `readyAt` to
 * `sentAt` and every suite stays green while the map now lies about which
 * question the entity answers.
 *
 * So the correspondence is asserted directly, against the queries the REAL
 * fetchers issue through the real registration table: for every catalog
 * entity, exactly one `where` column carries the window's exclusive bound, and
 * it is the one the map names. Change either side alone and this goes red.
 */

const CLIENT_ID = "client-1";
const WINDOW = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  toExclusive: new Date("2026-07-08T00:00:00.000Z"),
};

/** Whether a `where` value is the window's upper bound (`{ lt: toExclusive }`). */
function isWindowBound(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const bound = (value as { lt?: unknown }).lt;
  return bound instanceof Date && bound.getTime() === WINDOW.toExclusive.getTime();
}

/** Every `where` column carrying the window bound, at any nesting depth. */
function windowAnchors(where: unknown, found: Set<string>): Set<string> {
  if (where === null || typeof where !== "object") return found;
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (isWindowBound(value)) found.add(key);
    else windowAnchors(value, found);
  }
  return found;
}

/**
 * Records the `where` of every delegate call and returns nothing, so exactly
 * one query runs per entity and the recorded shape is the fetcher's own.
 */
function recordingDb(calls: unknown[]): ReportSourceDb {
  const findMany = (args: { where: unknown }): Promise<never[]> => {
    calls.push(args.where);
    return Promise.resolve([]);
  };
  // One recorder behind every delegate: the fetchers differ in shape, not in
  // how they window, which is the only thing this file looks at.
  return new Proxy(
    {},
    { get: () => ({ findMany }) },
  ) as unknown as ReportSourceDb;
}

const CATALOG: FieldCatalog = reportCatalog;

/** The first measure of an entity — enough to make a runnable spec. */
function anyMeasureOf(entity: string): string {
  const fields = CATALOG.entities[entity]?.fields ?? {};
  const measure = Object.entries(fields).find(([, def]) => def.role === "measure")?.[0];
  if (!measure) throw new Error(`Entity "${entity}" declares no measure.`);
  return measure;
}

describe("REPORT_ENTITY_DATE_FIELD matches the fetchers", () => {
  const entities = Object.keys(reportCatalog.entities);

  it.each(entities)("%s windows on the column the map names", async (entity) => {
    const calls: unknown[] = [];
    const source = createTenantReportDataSource(
      () => Promise.resolve(recordingDb(calls)),
      CLIENT_ID,
      WINDOW,
    );
    const spec = reportSpecSchema.parse({
      entity,
      measures: [{ field: anyMeasureOf(entity), alias: "valor" }],
      presentation: { kind: "table" },
    });
    await source.execute(compileReport(spec, reportCatalog));

    expect(calls.length).toBeGreaterThan(0);
    const anchors = calls.reduce<Set<string>>(
      (found, where) => windowAnchors(where, found),
      new Set<string>(),
    );
    expect([...anchors]).toEqual([REPORT_ENTITY_DATE_FIELD[entity]]);
  });

  it("declares a date field for every catalog entity and nothing else", () => {
    expect(Object.keys(REPORT_ENTITY_DATE_FIELD).sort()).toEqual([...entities].sort());
  });

  it("scopes every fetcher to the calling tenant", async () => {
    for (const entity of entities) {
      const calls: unknown[] = [];
      const scoped = createTenantReportDataSource(
        () => Promise.resolve(recordingDb(calls)),
        CLIENT_ID,
        WINDOW,
      );
      const scopedSpec = reportSpecSchema.parse({
        entity,
        measures: [{ field: anyMeasureOf(entity), alias: "valor" }],
        presentation: { kind: "table" },
      });
      await scoped.execute(compileReport(scopedSpec, reportCatalog));
      expect(JSON.stringify(calls), entity).toContain(CLIENT_ID);
    }
  });
});
