import { DISCOUNT_SCOPES, type DiscountScope, type DiscountType } from "../engine/kinds";

/**
 * The KIND of promotion an operator chooses, and the (type, scope) pair it
 * stands for.
 *
 * The engine stores two independent columns — `type` (how the money is
 * computed) and `scope` (what it is computed over) — and that is right for an
 * evaluator, which has to answer both questions separately. It is wrong for the
 * person creating the promotion: most of the sixteen combinations are not
 * offers anybody sells, and the form used to present all of them. An operator
 * could pick "Preço de combo" with scope `ORDER`, which the write path then
 * refused, or pick scope `COMBO` and hunt for the reward input three screens
 * up.
 *
 * So the form asks ONE question — what kind of promotion is this? — and derives
 * the pair:
 *
 * | kind | type | scope | the operator still chooses |
 * |---|---|---|---|
 * | `PERCENTAGE` | `PERCENTAGE` | ORDER / CATEGORY / ITEM | the rate, and what it covers |
 * | `FIXED_AMOUNT` | `FIXED_AMOUNT` | ORDER / CATEGORY / ITEM | the amount, and what it covers |
 * | `COMBO` | `PERCENTAGE` or `FIXED_AMOUNT` | `COMBO` | the groups, and which of the two rewards |
 * | `FREE_UNITS` | `FREE_UNITS` | `COMBO` | the products, how many, how many free |
 *
 * Two consequences worth stating, because both are deliberate:
 *
 * **A combo is a DISCOUNT off its items, never a price.** "2 refrigerantes, 2
 * hambúrgueres e 2 batatas com 15% de desconto" and "…menos R$ 5,00" are the
 * two offers a merchant describes; a flat "por R$ 49,90" reprices the group and
 * silently goes wrong the moment one of its items changes price. `BUNDLE_PRICE`
 * is still a legal type in the engine and in the database — an older rule that
 * uses it keeps working and keeps being editable, see {@link kindOptions} — it
 * is simply not offered for a new promotion.
 *
 * **`COMBO` scope is not a choice any more.** It was never one: a combo is
 * defined by its groups, so "combo scope, but with an order-wide discount" is
 * not an offer. The scope toggle therefore lists the three scopes that are
 * genuinely a choice, and the two combo kinds carry `COMBO` implicitly.
 */

/** The kinds offered for a NEW promotion, in the order the toggle shows them. */
export const DISCOUNT_KINDS = ["PERCENTAGE", "FIXED_AMOUNT", "COMBO", "FREE_UNITS"] as const;

/**
 * Every kind the form can HOLD, which is one more than it offers: a rule saved
 * as `BUNDLE_PRICE` before combos became a discount still has to open, edit and
 * save without losing what it is.
 */
export type DiscountKind = (typeof DISCOUNT_KINDS)[number] | "BUNDLE_PRICE";

/**
 * True when this kind's targets are groups — a builder, not a flat picker, and
 * `COMBO` scope rather than a scope the operator chose.
 *
 * The list is inline rather than an exported constant: nothing outside this
 * predicate should be branching on the set, and an exported one invites a
 * second `includes` that drifts from this one.
 */
export function isComboKind(kind: string): boolean {
  return kind === "COMBO" || kind === "FREE_UNITS" || kind === "BUNDLE_PRICE";
}

/** The scopes the toggle offers: every scope except the one a kind implies. */
export const SELECTABLE_DISCOUNT_SCOPES: readonly DiscountScope[] = DISCOUNT_SCOPES.filter(
  (scope) => scope !== "COMBO",
);

/**
 * Which kind an existing rule is, read back from the pair it was stored as.
 *
 * `FREE_UNITS` is checked before the scope because it is the narrower fact: it
 * is only ever legal at `COMBO` scope, so the type alone identifies it.
 */
export function kindOf(rule: { type: string; scope: string } | null): DiscountKind {
  if (rule === null) return "PERCENTAGE";
  if (rule.type === "BUNDLE_PRICE") return "BUNDLE_PRICE";
  if (rule.type === "FREE_UNITS") return "FREE_UNITS";
  if (rule.scope === "COMBO") return "COMBO";
  return rule.type === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
}

/**
 * The kinds this particular form may show — the four, plus `BUNDLE_PRICE` when
 * that is what is being edited.
 *
 * Appended rather than inserted so the four keep the positions an operator has
 * learned, and present ONLY on the legacy rule's own form: an operator editing
 * a percentage promotion is not offered a bundle price they cannot create.
 */
export function kindOptions(editing: { type: string; scope: string } | null): DiscountKind[] {
  const kind = kindOf(editing);
  return kind === "BUNDLE_PRICE" ? [...DISCOUNT_KINDS, kind] : [...DISCOUNT_KINDS];
}

/**
 * A combo's reward is one of the two plain types, chosen separately from the
 * kind — "15% off the combo" and "R$ 5,00 off the combo" are the same kind of
 * promotion with different arithmetic.
 */
export const COMBO_REWARDS = ["PERCENTAGE", "FIXED_AMOUNT"] as const;

/** Which reward an existing combo was saved with. */
export function comboRewardOf(rule: { type: string } | null): string {
  return rule?.type === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
}

/**
 * The engine pair this form currently describes.
 *
 * The one place the four questions on screen become the two columns the API
 * takes, so nothing downstream has to know that `COMBO` is a kind rather than a
 * type. A stale `scope` left over from a kind switch is clamped to `ORDER`
 * rather than trusted: the toggle is unmounted at combo kinds, so its value is
 * whatever it was before the operator changed their mind.
 */
export function typeAndScopeFor(values: {
  kind: string;
  comboReward: string;
  scope: string;
}): { type: DiscountType; scope: DiscountScope } {
  if (values.kind === "COMBO") {
    const type = values.comboReward === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
    return { type, scope: "COMBO" };
  }
  if (values.kind === "FREE_UNITS") return { type: "FREE_UNITS", scope: "COMBO" };
  if (values.kind === "BUNDLE_PRICE") return { type: "BUNDLE_PRICE", scope: "COMBO" };
  const type = values.kind === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
  return { type, scope: values.scope === "COMBO" ? "ORDER" : (values.scope as DiscountScope) };
}
