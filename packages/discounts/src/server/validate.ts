import {
  MAX_PERCENT_OFF_BP,
  normalizeDiscountCode,
  type DiscountScope,
  type DiscountTrigger,
  type DiscountType,
} from "../engine/kinds";
import type { DiscountsServerCopy } from "./copy";

/**
 * The write-time rule set for a discount (FUT-244).
 *
 * Every rule here has a twin somewhere else, and that is the point:
 *
 *  - most of them can also be expressed as database CHECK constraints. The
 *    database is the thing that cannot be bypassed; this layer exists so the
 *    operator gets a sentence naming the FIELD instead of a constraint name;
 *  - the "at least one target" rule has NO twin in SQL — a CHECK cannot see
 *    another table's rows — so this module is its only enforcement point;
 *  - an admin form re-states them client-side for instant feedback. A form is
 *    a convenience, never an authority: an MCP tool call and any direct REST
 *    caller land here, so the server re-validates everything.
 *
 * Money is integer cents and the percentage is basis points throughout, so
 * nothing downstream has to know about percent-shaped floats.
 *
 * The sentences are NOT here — {@link DiscountsServerCopy} carries them, and
 * this module names the key. The FIELD each failure reports against is the
 * package's own vocabulary and stays here, because a form binds to it.
 */

/** One discount as the admin writes it. Targets are ignored for `ORDER` scope. */
export interface DiscountWriteInput {
  name: string;
  type: DiscountType;
  /** 1..10000. Required iff `type === "PERCENTAGE"`. */
  percentOffBp: number | null;
  /** Cents, > 0. Required iff `type === "FIXED_AMOUNT"`. */
  amountOffCents: number | null;
  scope: DiscountScope;
  trigger: DiscountTrigger;
  /** Raw code as typed; normalized here. Required iff `trigger === "CODE"`. */
  code: string | null;
  /** Calendar dates (`YYYY-MM-DD`) as the form sends them, or null. */
  startsAt: string | null;
  endsAt: string | null;
  minSubtotalCents: number | null;
  usageLimit: number | null;
  perBuyerLimit: number | null;
  stackable: boolean;
  active: boolean;
  /** Target category ids — read only when `scope === "CATEGORY"`. */
  categoryIds: readonly string[];
  /** Target menu-item ids — read only when `scope === "ITEM"`. */
  menuItemIds: readonly string[];
}

/**
 * A rejected write: 422, carrying the FORM field the operator must fix and the
 * copy key whose sentence says so.
 *
 * A class rather than a returned union because the rules are asserted down a
 * call chain and every one of them aborts the write; the routes catch it and
 * turn it into `{ error, issues: { <field>: error } }`, which is the shape a
 * form reads its per-input errors out of.
 */
export class DiscountValidationError extends Error {
  /** Always 422 — every rule here is "the operator can fix this and retry". */
  readonly status = 422;
  /** The form input to paint, e.g. `percentOff`, `code`, `targets`. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "DiscountValidationError";
    this.field = field;
  }
}

function invalid(field: string, message: string): DiscountValidationError {
  return new DiscountValidationError(field, message);
}

/** The value half: exactly one of the two columns, inside its legal range. */
function assertValue(input: DiscountWriteInput, copy: DiscountsServerCopy): void {
  if (input.type === "PERCENTAGE") {
    const bp = input.percentOffBp;
    if (bp === null || !Number.isInteger(bp) || bp <= 0 || bp > MAX_PERCENT_OFF_BP) {
      throw invalid("percentOff", copy.invalidPercent);
    }
    return;
  }
  const cents = input.amountOffCents;
  if (cents === null || !Number.isInteger(cents) || cents <= 0) {
    throw invalid("amountOff", copy.invalidAmount);
  }
}

/**
 * The code half. A CODE discount without a code can never be redeemed, and an
 * AUTOMATIC one carrying a code would be redeemable two different ways — so the
 * relationship is an equivalence, not a "required if".
 */
function assertTrigger(input: DiscountWriteInput, copy: DiscountsServerCopy): string | null {
  if (input.trigger !== "CODE") return null;
  const code = normalizeDiscountCode(input.code ?? "");
  if (code.length === 0) throw invalid("code", copy.codeRequired);
  return code;
}

/**
 * The targets. This is the rule with no DB twin: a CHECK constraint cannot
 * count rows in another table, so a CATEGORY-scoped discount with an empty
 * target list would be accepted by the database and then silently cover
 * NOTHING — a promotion that exists, looks live in the list, and never fires.
 */
function assertTargets(input: DiscountWriteInput, copy: DiscountsServerCopy): void {
  if (input.scope === "CATEGORY" && input.categoryIds.length === 0) {
    throw invalid("targets", copy.categoryTargetRequired);
  }
  if (input.scope === "ITEM" && input.menuItemIds.length === 0) {
    throw invalid("targets", copy.itemTargetRequired);
  }
}

/** A calendar date at UTC midnight, or null. The wire format is `YYYY-MM-DD`. */
function toDate(value: string | null, field: string, copy: DiscountsServerCopy): Date | null {
  if (value === null || value === "") return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw invalid(field, copy.invalidDate);
  return parsed;
}

/**
 * The window, half-open `[startsAt, endsAt)`. `endsAt` is EXCLUSIVE, so equal
 * bounds are an EMPTY window rather than a one-instant one — an operator who
 * typed the same date twice meant something else, and an always-empty promotion
 * is worse than a rejected form.
 */
function assertWindow(
  input: DiscountWriteInput,
  copy: DiscountsServerCopy,
): { startsAt: Date | null; endsAt: Date | null } {
  const startsAt = toDate(input.startsAt, "startsAt", copy);
  const endsAt = toDate(input.endsAt, "endsAt", copy);
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw invalid("endsAt", copy.endsBeforeStarts);
  }
  return { startsAt, endsAt };
}

/** A cap of zero is not a cap, it is a discount that can never be used. */
function assertPositiveOrNull(value: number | null, field: string, message: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value <= 0) throw invalid(field, message);
}

function assertLimits(input: DiscountWriteInput, copy: DiscountsServerCopy): void {
  assertPositiveOrNull(input.minSubtotalCents, "minSubtotal", copy.invalidMinSubtotal);
  assertPositiveOrNull(input.usageLimit, "usageLimit", copy.invalidUsageLimit);
  assertPositiveOrNull(input.perBuyerLimit, "perBuyerLimit", copy.invalidPerBuyerLimit);
}

/** The scalar columns of a discount row, validated and normalized. */
export interface DiscountScalars {
  name: string;
  type: DiscountType;
  percentOffBp: number | null;
  amountOffCents: number | null;
  scope: DiscountScope;
  trigger: DiscountTrigger;
  code: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalCents: number | null;
  usageLimit: number | null;
  perBuyerLimit: number | null;
  stackable: boolean;
  active: boolean;
}

/** The target ids of one write, de-duplicated and narrowed to the scope. */
export interface DiscountTargets {
  categoryIds: string[];
  menuItemIds: string[];
}

/**
 * Validate one write and fold it into the exact column values a host persists.
 *
 * The unused half of each either/or pair is forced to NULL rather than passed
 * through: a PERCENTAGE discount that kept a leftover `amountOffCents` from the
 * form's other branch would violate the "exactly one value column" constraint
 * at the database, and the operator would see a 500 for a form they filled in
 * correctly. Same for a code left behind by flipping the trigger back to
 * AUTOMATIC.
 */
export function toDiscountScalars(
  input: DiscountWriteInput,
  copy: DiscountsServerCopy,
): DiscountScalars {
  assertValue(input, copy);
  const code = assertTrigger(input, copy);
  assertTargets(input, copy);
  const { startsAt, endsAt } = assertWindow(input, copy);
  assertLimits(input, copy);

  const isPercentage = input.type === "PERCENTAGE";
  return {
    name: input.name.trim(),
    type: input.type,
    percentOffBp: isPercentage ? input.percentOffBp : null,
    amountOffCents: isPercentage ? null : input.amountOffCents,
    scope: input.scope,
    trigger: input.trigger,
    code,
    startsAt,
    endsAt,
    minSubtotalCents: input.minSubtotalCents,
    usageLimit: input.usageLimit,
    perBuyerLimit: input.perBuyerLimit,
    stackable: input.stackable,
    active: input.active,
  };
}

/**
 * The validated wire body as the routes receive it — every optional field is
 * `T | null | undefined` because the wire lets a client omit what does not
 * apply to its branch (an AUTOMATIC discount sends no `code`).
 *
 * Declared structurally rather than as `z.infer<typeof createDiscountBody>` so
 * this module stays free of the schema module, which imports it back.
 */
export interface DiscountWriteBody {
  name: string;
  type: DiscountType;
  percentOffBp?: number | null;
  amountOffCents?: number | null;
  scope: DiscountScope;
  trigger: DiscountTrigger;
  code?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  minSubtotalCents?: number | null;
  usageLimit?: number | null;
  perBuyerLimit?: number | null;
  stackable: boolean;
  active: boolean;
  categoryIds?: string[];
  menuItemIds?: string[];
}

/**
 * Fold the wire body into the write input. Both writes go through it so
 * "omitted" and "explicitly null" collapse to the same thing in exactly one
 * place — a discount is always saved WHOLE, so an absent field means "no
 * value", never "leave the stored one alone".
 */
export function toDiscountWriteInput(body: DiscountWriteBody): DiscountWriteInput {
  // One helper rather than a dozen inline `??`: each of those is a branch the
  // complexity gate counts, and the rule they encode is a single sentence.
  const orNull = <T,>(value: T | null | undefined): T | null => value ?? null;
  const orEmpty = (value: string[] | undefined): string[] => value ?? [];
  return {
    name: body.name,
    type: body.type,
    percentOffBp: orNull(body.percentOffBp),
    amountOffCents: orNull(body.amountOffCents),
    scope: body.scope,
    trigger: body.trigger,
    code: orNull(body.code),
    startsAt: orNull(body.startsAt),
    endsAt: orNull(body.endsAt),
    minSubtotalCents: orNull(body.minSubtotalCents),
    usageLimit: orNull(body.usageLimit),
    perBuyerLimit: orNull(body.perBuyerLimit),
    stackable: body.stackable,
    active: body.active,
    categoryIds: orEmpty(body.categoryIds),
    menuItemIds: orEmpty(body.menuItemIds),
  };
}

/**
 * The target ids this scope actually stores. An ORDER-scoped discount carries
 * none — dropping them here (instead of trusting the caller) is what keeps a
 * scope change from leaving orphan join rows that would quietly re-narrow the
 * discount if the scope were ever flipped back.
 */
export function targetsForScope(input: DiscountWriteInput): DiscountTargets {
  return {
    categoryIds: input.scope === "CATEGORY" ? [...new Set(input.categoryIds)] : [],
    menuItemIds: input.scope === "ITEM" ? [...new Set(input.menuItemIds)] : [],
  };
}
