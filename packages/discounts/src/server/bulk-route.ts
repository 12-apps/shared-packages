import { DISCOUNT_BULK_MAX_IDS, type DiscountBulkOperation } from "../bulk";
import type { WireRequest, WireResponse } from "@12-apps/wiring";

import { runBulk, type BulkContext } from "./bulk-run";
import { EN_US_DISCOUNTS_SERVER_COPY } from "./en-US";
import { bulkDiscountsBody } from "./bulk-wire";
import { readZoneFor } from "./calendar-days";
import { resolveDiscountsCopy } from "./copy";
import { bulkCopyFor } from "./fallback-copy";
import { DISCOUNTS_WRITE } from "./contribution";
import { problemsOf } from "./problems";
import type { DiscountRoute, DiscountsActor, DiscountsApiConfig } from "./routes";

/** Split from `./routes` for the file-size gate; `endpoint` is the routes' own observed fold. */
type Endpoint = (
  config: DiscountsApiConfig,
  route: string,
  handle: (request: WireRequest<DiscountsActor>) => Promise<WireResponse>,
) => (request: WireRequest<DiscountsActor>) => Promise<WireResponse>;

/**
 * The plan pass of an all-or-nothing call: nothing is written; a 422 with every
 * row that cannot take the change, by its path (`ids.N`, `rows.N` for an undo).
 */
async function atomicRefusal(ctx: BulkContext, operation: DiscountBulkOperation): Promise<WireResponse | null> {
  const plan = await runBulk(ctx, { ...operation, validateOnly: true });
  const prefix = operation.operation === "undo" ? "rows" : "ids";
  const problems = plan.rows.flatMap((row, index) =>
    row.status === "skipped" || row.status === "failed"
      ? [{ path: `${prefix}.${index}`, message: `${row.name ?? row.id}: ${row.message}` }]
      : [],
  );
  if (problems.length === 0) return null;
  return { status: 422, body: { error: ctx.words.atomicRefused.replace("{count}", String(problems.length)), problems } };
}

/**
 * `POST /discounts/bulk` (FUT-4420): activate, deactivate, extend the validity
 * of, or undo a batch of up to 500 discounts.
 *
 * The same `discounts:write` as the single-row edit - a batch never opens a
 * door the row's own edit keeps shut.
 *
 * The SCREEN's call is per row, on the owner's word: a row that cannot take the
 * change says why and the rest go on. The MCP tool's call is ALL-OR-NOTHING
 * (`allOrNothing`, decided on FUT-4420 under the MCP protocol): every row is
 * planned first, and if any would be skipped or fail the answer is a 422 with
 * every problem and its row path and nothing is written. The store port has no
 * transaction, so that is plan-then-write, not an atomic commit.
 *
 * Each row is written under a condition that guards the WINDOW and the ACTIVE
 * flag only (see `./bulk-run`); another column changed between the read and the
 * write is re-stated from the read, as the single-row PATCH also does.
 */
export function createBulkRoute(
  config: DiscountsApiConfig,
  endpoint: Endpoint,
): DiscountRoute {
  return {
    method: "POST",
    path: "/discounts/bulk",
    permission: DISCOUNTS_WRITE,
    handle: endpoint(config, "POST /discounts/bulk", async (request) => {
      const { actor, body, locale } = request;
      const copy = resolveDiscountsCopy(config.copy, locale);
      const parsed = bulkDiscountsBody.safeParse(body);
      if (!parsed.success) {
        // Too many ids is its own sentence (the host's, with the cap in it).
        // Only the id lists have the cap: a too-big `days` is its own problem, not "too many ids".
        const tooMany = parsed.error.issues.some(
          (issue) => issue.code === "too_big" && (issue.path[0] === "ids" || issue.path[0] === "rows"),
        );
        const error = tooMany
          ? bulkCopyFor(copy, locale).tooManyIds.replace("{max}", String(DISCOUNT_BULK_MAX_IDS))
          : copy.invalidQuery;
        return { status: 422, body: { error, problems: problemsOf(parsed.error) } };
      }
      const operation = parsed.data as DiscountBulkOperation;
      // An agent reads English whatever the host's language (MCP protocol).
      const words = operation.allOrNothing === true ? EN_US_DISCOUNTS_SERVER_COPY.bulk : bulkCopyFor(copy, locale);
      const zone = await readZoneFor(config.storeTimeZone, actor.clientId, config.logger);
      const ctx = { store: config.store, clientId: actor.clientId, zone, now: new Date(), words, logger: config.logger };
      if (operation.allOrNothing === true) {
        const refused = await atomicRefusal(ctx, operation);
        if (refused !== null) return refused;
        if (operation.validateOnly === true) return { status: 200, body: { data: await runBulk(ctx, operation) } };
      }
      const result = await runBulk(ctx, operation);
      const { counts } = result;
      config.logger.info(
        `bulk ${result.operation}${result.validateOnly ? " (validateOnly)" : ""} for tenant ${actor.clientId}: ` +
          `${counts.ok} changed, ${counts.unchanged} unchanged, ${counts.skipped} skipped, ${counts.failed} failed`,
      );
      return { status: 200, body: { data: result } };
    }),
  };
}
