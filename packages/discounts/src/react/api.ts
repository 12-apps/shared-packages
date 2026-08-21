import type { ComboRequirement } from "../engine/types";

import type { DiscountsFormatters } from "./format";
import type { DiscountsResult, DiscountsTransport } from "./transport";

/**
 * The wire, and the one place the FORM's shape becomes the API's.
 *
 * A form holds strings — every value in a text input is one — while the API
 * takes integers, basis points and nulls. That coercion is a real rule set, not
 * plumbing, and it has exactly one rule worth stating: a BLANK field means "no
 * value" (`null`), never zero, because `0` is a real and different answer for a
 * limit or a minimum. A host repeating this per call site is how one screen
 * starts saving `0` where another saves `null`.
 */

/** A discount as the CRUD endpoints echo it — JSON, so dates are ISO strings. */
export interface DiscountWireRecord {
  id: string;
  name: string;
  type: string;
  percentOffBp: number | null;
  amountOffCents: number | null;
  bundlePriceCents?: number | null;
  freeUnits?: number | null;
  maxComboApplications?: number | null;
  comboRequirements?: ComboRequirement[];
  scope: string;
  trigger: string;
  code: string | null;
  startsAt: string | null;
  endsAt: string | null;
  minSubtotalCents: number | null;
  usageLimit: number | null;
  perBuyerLimit: number | null;
  usageCount: number;
  stackable: boolean;
  active: boolean;
  categoryIds: string[];
  menuItemIds: string[];
  createdAt: string;
}

/** The pagination envelope the list endpoint answers with. */
export interface DiscountsPagination {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface DiscountsPage {
  data: DiscountWireRecord[];
  pagination: DiscountsPagination;
}

/** One selectable target, as `GET /discounts/targets` answers it. */
export interface WireTarget {
  id: string;
  name: string;
  parentId?: string | null;
}

/** One registered collection and its rows. */
export interface WireTargetGroup {
  targetType: string;
  slug: string;
  label: string;
  nests: boolean;
  targets: WireTarget[];
}

/** The form's payload, still in FORM shape. */
export interface DiscountFormPayload {
  name: string;
  type: string;
  /** 0–100 with up to two decimals, in the operator's own notation. */
  percentOff: string;
  /** A money amount, as the currency field stores it. */
  amountOff: string;
  /** What the matched combo group costs, as the currency field stores it. */
  bundlePrice: string;
  /** How many of the matched units are free, as typed. */
  freeUnits: string;
  /** How many combos one cart may claim. Blank = as often as it fits. */
  maxComboApplications: string;
  scope: string;
  trigger: string;
  code: string;
  startsAt: string;
  endsAt: string;
  minSubtotal: string;
  usageLimit: string;
  perBuyerLimit: string;
  stackable: boolean;
  active: boolean;
  categoryIds: string[];
  menuItemIds: string[];
  /** The combo's groups, in the operator's own order. Empty at every other scope. */
  comboRequirements: readonly ComboRequirement[];
}

/** A money amount as integer cents, or null when blank. */
function toCents(typed: string, formatters: DiscountsFormatters): number | null {
  const amount = formatters.parseDecimal(typed);
  return amount === null ? null : Math.round(amount * 100);
}

/** A whole-number cap, or null when blank ("no cap"). */
function toCount(typed: string, formatters: DiscountsFormatters): number | null {
  const parsed = formatters.parseDecimal(typed);
  return parsed === null ? null : Math.trunc(parsed);
}

/**
 * A percentage as BASIS POINTS.
 *
 * The form takes 0–100 with two decimals because that is how an operator thinks
 * about a promotion; the column stores basis points because that is how the
 * engine computes without a float. The `Math.round` after the ×100 is what
 * keeps "12,5" exactly 1250 rather than 1249.9999999999998.
 */
function toBasisPoints(typed: string, formatters: DiscountsFormatters): number | null {
  const percent = formatters.parseDecimal(typed);
  return percent === null ? null : Math.round(percent * 100);
}

/** Blank → null, so an unused branch's leftover text never reaches a column. */
function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The wire body both writes send — a discount is always saved WHOLE. */
export function toWriteBody(
  input: DiscountFormPayload,
  formatters: DiscountsFormatters,
): Record<string, unknown> {
  const isCombo = input.scope === "COMBO";
  return {
    name: input.name.trim(),
    type: input.type,
    // Exactly one value column, chosen by the TYPE, with the other three
    // forced to null. The four are mutually exclusive at the database
    // (`discounts_value_check`), so carrying a leftover from a branch the
    // operator flipped away from is a 500 on a form they filled in correctly —
    // the same reason the server's own folder nulls them rather than passing
    // them through.
    percentOffBp:
      input.type === "PERCENTAGE" ? toBasisPoints(input.percentOff, formatters) : null,
    amountOffCents: input.type === "FIXED_AMOUNT" ? toCents(input.amountOff, formatters) : null,
    bundlePriceCents:
      input.type === "BUNDLE_PRICE" ? toCents(input.bundlePrice, formatters) : null,
    freeUnits: input.type === "FREE_UNITS" ? toCount(input.freeUnits, formatters) : null,
    // The combo SPEC, narrowed to the scope for the reason the id lists below
    // are: a rule whose scope moved off COMBO keeps neither its groups nor its
    // cap, or it would go on being matched as a combo by a screen that no
    // longer shows one.
    comboRequirements: isCombo ? [...input.comboRequirements] : [],
    maxComboApplications: isCombo ? toCount(input.maxComboApplications, formatters) : null,
    scope: input.scope,
    trigger: input.trigger,
    code: input.trigger === "CODE" ? toNullable(input.code) : null,
    startsAt: toNullable(input.startsAt),
    endsAt: toNullable(input.endsAt),
    minSubtotalCents: toCents(input.minSubtotal, formatters),
    usageLimit: toCount(input.usageLimit, formatters),
    perBuyerLimit: toCount(input.perBuyerLimit, formatters),
    stackable: input.stackable,
    active: input.active,
    // Narrowed to the scope on the way OUT as well as on the way in: leaving a
    // stale id list on a rule whose scope changed is how a promotion goes on
    // covering something its screen no longer shows.
    categoryIds: input.scope === "CATEGORY" ? input.categoryIds : [],
    menuItemIds: input.scope === "ITEM" ? input.menuItemIds : [],
  };
}

/** The bound wire client the screens use. Nothing else performs I/O. */
export interface DiscountsApiClient {
  list(search: string): Promise<DiscountsPage>;
  targets(): Promise<readonly WireTargetGroup[]>;
  create(input: DiscountFormPayload): Promise<DiscountsResult<DiscountWireRecord>>;
  update(id: string, input: DiscountFormPayload): Promise<DiscountsResult<{ id: string }>>;
  remove(id: string): Promise<DiscountsResult<{ id: string }>>;
}

export function createDiscountsApiClient(
  apiBase: string,
  transport: DiscountsTransport,
  formatters: DiscountsFormatters,
): DiscountsApiClient {
  const collection = `${apiBase}/discounts`;
  const item = (id: string): string => `${collection}/${encodeURIComponent(id)}`;
  return {
    list: (search) => transport.get<DiscountsPage>(search ? `${collection}?${search}` : collection),
    targets: () =>
      transport
        .get<{ data: WireTargetGroup[] }>(`${collection}/targets`)
        .then((payload) => payload.data),
    create: (input) =>
      transport.send<DiscountWireRecord>(collection, "POST", toWriteBody(input, formatters)),
    update: (id, input) =>
      transport.send<{ id: string }>(item(id), "PATCH", toWriteBody(input, formatters)),
    remove: (id) => transport.send<{ id: string }>(item(id), "DELETE"),
  };
}
