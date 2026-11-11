import { DISCOUNT_BULK_MAX_IDS, type DiscountBulkOperation } from "../bulk";
import type { WireRequest, WireResponse } from "@12-apps/wiring";

import { bulkIdsOf, runBulk } from "./bulk-run";
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
 * `POST /discounts/bulk` (FUT-4420): activate, deactivate, extend the validity
 * of, or undo a batch of up to 500 discounts, answering EVERY row.
 *
 * The same `discounts:write` as the single-row edit - a batch never opens a
 * door the row's own edit keeps shut. The batch is not all-or-nothing, on the
 * owner's word: a row that cannot take the change says why and the rest go on.
 * Each row is written under a condition (see `./bulk-run`), so a concurrent
 * change is detected, not overwritten.
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
      const words = bulkCopyFor(copy, locale);
      const parsed = bulkDiscountsBody.safeParse(body);
      if (!parsed.success) {
        return { status: 422, body: { error: copy.invalidQuery, problems: problemsOf(parsed.error) } };
      }
      const operation = parsed.data as DiscountBulkOperation;
      if (bulkIdsOf(operation).length > DISCOUNT_BULK_MAX_IDS) {
        const error = words.tooManyIds.replace("{max}", String(DISCOUNT_BULK_MAX_IDS));
        return { status: 422, body: { error, problems: [{ path: "ids", message: error }] } };
      }
      const zone = await readZoneFor(config.storeTimeZone, actor.clientId, config.logger);
      const result = await runBulk(
        { store: config.store, clientId: actor.clientId, zone, now: new Date(), words, logger: config.logger },
        operation,
      );
      const { counts } = result;
      config.logger.info(
        `bulk ${result.operation}${result.validateOnly ? " (validateOnly)" : ""} for tenant ${actor.clientId}: ` +
          `${counts.ok} changed, ${counts.unchanged} unchanged, ${counts.skipped} skipped, ${counts.failed} failed`,
      );
      return { status: 200, body: { data: result } };
    }),
  };
}
