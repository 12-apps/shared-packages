/**
 * `@12-apps/discounts/server` — the admin CRUD surface.
 *
 * Behind its own subpath so a browser bundle that only prices a cart (the
 * package root) never resolves zod or the search engine. The wiring manifest
 * for these capabilities is `@12-apps/discounts/manifest/server`.
 */

export {
  createApiDiscounts,
  type DiscountRoute,
  type DiscountsActor,
  type DiscountsApiConfig,
} from "./routes";

export { missingServerCopy, type DiscountsServerCopy } from "./copy";

export {
  DISCOUNTS_PERMISSIONS,
  DISCOUNTS_READ,
  DISCOUNTS_WRITE,
} from "./contribution";

export type {
  DiscountListInput,
  DiscountPage,
  DiscountRecord,
  DiscountStore,
  DiscountWrite,
} from "./store";

export {
  DiscountValidationError,
  targetsForScope,
  toDiscountScalars,
  toDiscountWriteInput,
  type DiscountScalars,
  type DiscountTargets,
  type DiscountWriteBody,
  type DiscountWriteInput,
} from "./validate";

export { comboRequirementsForScope, toComboColumns, type ComboColumns } from "./validate-combo";

export { discountSearchConfig } from "./search";

export {
  comboRequirementSchema,
  createDiscountBody,
  createDiscountListQuery,
  discountCollectionParams,
  discountItemParams,
  discountSchema,
  DISCOUNTS_MCP_TOOLS,
  listDiscountsQuery,
  updateDiscountBody,
} from "./mcp";
