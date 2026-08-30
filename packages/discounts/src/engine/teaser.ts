import { comboRuleAcceptsLine } from "./combo-match";
import { buildLineIndex, coveredLineIds } from "./eligibility";
import { compareRuleOrder } from "./evaluate-passes";
import type { DiscountType } from "./kinds";
import { nextWindowToday, scheduleCovers, type LocalClock } from "./schedule";
import type { DiscountCartLine, DiscountRule } from "./types";

/**
 * "Happy hour: 10% das 16h às 20h" — what a card may say about a promotion
 * that has not started yet (FUT-996).
 *
 * This returns a LABELLING fact, never a price, and that distinction is not a
 * new one: `previewItemDiscount` already refuses to badge a combo because "a
 * combo price only exists once the OTHER components are in the cart, so
 * striking a single item's price through with it would advertise a number this
 * item alone can never reach", and `comboOffersForItem` exists precisely to say
 * the true half of that out loud. A happy hour before 16:00 is the same shape:
 * the OFFER is true, the PRICE is not yet. So it gets a sentence and no struck
 * price, and the badge takes over the moment the window opens.
 *
 * Without it a merchant's best promotion goes unsold to everyone who looks
 * before it starts — which, for a happy hour, is most of the day.
 *
 * Pure and copy-free like the rest of the engine: the merchant's `name` is the
 * only string here and it is already their own words. A host renders the
 * sentence around the two times.
 */

/** One promotion this item takes part in that opens later today. */
export interface ScheduledOfferTeaser {
  discountId: string;
  /** The merchant's own promotion name — already their copy, their language. */
  name: string;
  type: DiscountType;
  /** Basis points off. Non-null iff `type === "PERCENTAGE"`. */
  percentOffBp: number | null;
  /** Cents off. Non-null iff `type === "FIXED_AMOUNT"`. */
  amountOffCents: number | null;
  /** `HH:MM` the window opens, in the store's timezone. */
  from: string;
  /** `HH:MM` the window closes, exclusive. */
  to: string;
}

export interface ScheduledTeaserInput {
  /** The BASE (grouping) menu-item id the card renders. */
  menuItemId: string;
  /** The variation whose price the card shows, when it shows one. */
  variationMenuItemId?: string | null;
  /** The item's own category id followed by its ancestors, nearest first. */
  categoryPath: readonly string[];
  /** The tenant's live discount rules, loaded once for the whole menu. */
  rules: readonly DiscountRule[];
  /** Evaluation instant. Injected — this module never calls `new Date()`. */
  now: Date;
  /** `now` as the STORE's wall clock. Null ⇒ nothing is teased. */
  localNow?: LocalClock | null;
}

const TEASER_LINE_ID = "teaser";

function toTeaserLine(input: ScheduledTeaserInput): DiscountCartLine {
  return {
    lineId: TEASER_LINE_ID,
    menuItemId: input.menuItemId,
    variationMenuItemId: input.variationMenuItemId ?? null,
    categoryPath: input.categoryPath,
    quantity: 1,
    // A teaser asks whether the rule REACHES this item, which no price enters
    // into — and deliberately never asks whether it is running, since the
    // whole point is that it is not.
    unitPriceCents: 0,
  };
}

/**
 * Worth teasing at all: an automatic, live, unexhausted, SCHEDULED rule that is
 * not running at this moment.
 *
 * `ORDER` scope is excluded for the reason `previewItemDiscount` excludes it —
 * an order-wide promotion is not this item's offer, and teasing it on a card
 * would put the same sentence on every card in the menu.
 *
 * A rule with no schedule is excluded because it cannot be "starting later":
 * either it is running, in which case the badge already speaks, or its campaign
 * has not opened, which is a date and not an hour.
 */
function isTeasable(rule: DiscountRule, now: Date, localNow: LocalClock | null): boolean {
  if (!isTeasableShape(rule)) return false;
  if (!withinCampaign(rule, now)) return false;
  // Already running ⇒ the badge owns this card. Never both.
  if (scheduleCovers(rule.schedule, localNow)) return false;
  return rule.usageLimit === null || rule.usageCount < rule.usageLimit;
}

/**
 * The static half: a rule that could ever be teased at all.
 *
 * `ORDER` is excluded for the reason `previewItemDiscount` excludes it, and an
 * unscheduled rule for the reason in the header — it cannot be "starting
 * later", only running or not yet begun, and the second is a date.
 */
function isTeasableShape(rule: DiscountRule): boolean {
  if (rule.trigger !== "AUTOMATIC" || !rule.active || rule.scope === "ORDER") return false;
  return rule.schedule !== null && rule.schedule !== undefined;
}

/** Inside `[startsAt, endsAt)` — the CAMPAIGN, not the weekly schedule. */
function withinCampaign(rule: DiscountRule, now: Date): boolean {
  if (rule.startsAt !== null && now.getTime() < rule.startsAt.getTime()) return false;
  return rule.endsAt === null || now.getTime() < rule.endsAt.getTime();
}

/** Whether this rule reaches this item at all, by whichever route its scope uses. */
function reachesItem(rule: DiscountRule, line: DiscountCartLine): boolean {
  if (rule.scope === "COMBO") return comboRuleAcceptsLine(rule, line);
  return coveredLineIds(rule, [line], buildLineIndex([line])).has(TEASER_LINE_ID);
}

/**
 * Every promotion this item takes part in that opens later TODAY, in the
 * evaluator's canonical rule order so a card and a cart never disagree about
 * which of two promotions comes first.
 *
 * Empty is the common case and the one a host should render as nothing at all.
 */
export function upcomingOffersForItem(
  input: ScheduledTeaserInput,
): readonly ScheduledOfferTeaser[] {
  const localNow = input.localNow ?? null;
  if (localNow === null) return [];
  const line = toTeaserLine(input);
  return input.rules
    .filter((rule) => isTeasable(rule, input.now, localNow) && reachesItem(rule, line))
    .map((rule) => ({ rule, window: nextWindowToday(rule.schedule, localNow) }))
    .filter(
      (entry): entry is { rule: DiscountRule; window: NonNullable<typeof entry.window> } =>
        entry.window !== null,
    )
    .sort((a, b) => compareRuleOrder(a.rule, b.rule))
    .map(({ rule, window }) => ({
      discountId: rule.id,
      name: rule.name,
      type: rule.type,
      percentOffBp: rule.percentOffBp,
      amountOffCents: rule.amountOffCents,
      from: window.from,
      to: window.to,
    }));
}
