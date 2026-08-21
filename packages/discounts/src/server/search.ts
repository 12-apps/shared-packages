import { defineSearchConfig } from "@12-apps/shared-helpers/search";

import { DISCOUNT_SCOPES, DISCOUNT_TRIGGERS, DISCOUNT_TYPES } from "../engine/kinds";

/**
 * The admin discounts-list search contract (FUT-244): the backend equivalent of
 * a promotions grid's search box, pills and sort. Search is case-insensitive
 * over the discount name AND its coupon code, because an operator hunting for
 * `BEMVINDO10` types the code, not the promotion's marketing name.
 *
 * The three closed sets come from `../engine/kinds` rather than being spelled
 * out again here: the same arrays back a host's CHECK constraints and the MCP
 * enums, so a value this config would accept is by construction a value the
 * database will store.
 *
 * The grid's fourth pill — the VIGÊNCIA one (running / scheduled / ended) — is
 * deliberately ABSENT. It is a comparison between two nullable columns and the
 * current instant, which `filterableFields` cannot express at all, so it rides
 * as a separate `window` parameter the store resolves into its own predicate.
 * The parameter's VALUES are host words, which is why the store owns them: see
 * `DiscountListInput` in `./store`.
 */
export const discountSearchConfig = defineSearchConfig({
  searchableFields: ["name", "code"],
  searchMode: "insensitive",
  filterableFields: {
    type: { type: "string", operators: ["in"], allowedValues: [...DISCOUNT_TYPES] },
    scope: { type: "string", operators: ["in"], allowedValues: [...DISCOUNT_SCOPES] },
    trigger: { type: "string", operators: ["in"], allowedValues: [...DISCOUNT_TRIGGERS] },
    active: { type: "boolean", operators: ["eq"] },
  },
  sortableFields: [
    "name",
    "code",
    "type",
    "scope",
    "startsAt",
    "endsAt",
    "usageCount",
    "createdAt",
  ],
  // Newest first: a promotions list is a working queue, and the thing an
  // operator just created is the thing they want to see.
  defaultSort: { field: "createdAt", direction: "desc" },
});
