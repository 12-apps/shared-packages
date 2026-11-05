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
 * | `COMBO` | `PERCENTAGE`, `FIXED_AMOUNT` or `BUNDLE_PRICE` | `COMBO` | the groups, and which of the three rewards |
 * | `FREE_UNITS` | `FREE_UNITS` | `COMBO` | the products, how many, how many free |
 *
 * Two consequences worth stating, because both are deliberate:
 *
 * **A combo's reward is a discount off its items OR a closed price**
 * (FUT-4417). "2 refrigerantes, 2 hambúrgueres e 2 batatas com 15% de
 * desconto" and "…menos R$ 5,00" are two offers a merchant describes; "5
 * marmitas por R$ 120" is the third, and the one the form used to refuse. A
 * closed price reprices the matched group whatever its items cost — which is
 * exactly what the merchant asked for, and why the form says so under the price
 * field and previews it against the store's real prices ("Como fica no
 * carrinho"). `BUNDLE_PRICE` is therefore a combo REWARD, not a kind: a rule
 * saved with it before FUT-4417 opens as a combo with "Preço fechado" chosen.
 *
 * **`COMBO` scope is not a choice any more.** It was never one: a combo is
 * defined by its groups, so "combo scope, but with an order-wide discount" is
 * not an offer. The scope toggle therefore lists the three scopes that are
 * genuinely a choice, and the two combo kinds carry `COMBO` implicitly.
 */

/** The kinds the form offers, in the order the toggle shows them. */
export const DISCOUNT_KINDS = ["PERCENTAGE", "FIXED_AMOUNT", "COMBO", "FREE_UNITS"] as const;

/**
 * Every kind the form can hold. `BUNDLE_PRICE` is not one any more (FUT-4417):
 * it is the third reward of a `COMBO`, see {@link COMBO_REWARDS}.
 */
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/**
 * True when this kind's targets are groups — a builder, not a flat picker, and
 * `COMBO` scope rather than a scope the operator chose.
 *
 * The list is inline rather than an exported constant: nothing outside this
 * predicate should be branching on the set, and an exported one invites a
 * second `includes` that drifts from this one.
 */
export function isComboKind(kind: string): boolean {
  return kind === "COMBO" || kind === "FREE_UNITS";
}

/** The scopes the toggle offers: every scope except the one a kind implies. */
export const SELECTABLE_DISCOUNT_SCOPES: readonly DiscountScope[] = DISCOUNT_SCOPES.filter(
  (scope) => scope !== "COMBO",
);

/**
 * Which kind an existing rule is, read back from the pair it was stored as.
 *
 * `FREE_UNITS` is checked before the scope because it is the narrower fact: it
 * is only ever legal at `COMBO` scope, so the type alone identifies it. A
 * `BUNDLE_PRICE` rule is a combo (FUT-4417) — whatever scope it carries, since
 * the type is only legal at `COMBO`.
 */
export function kindOf(rule: { type: string; scope: string } | null): DiscountKind {
  if (rule === null) return "PERCENTAGE";
  if (rule.type === "FREE_UNITS") return "FREE_UNITS";
  if (rule.type === "BUNDLE_PRICE" || rule.scope === "COMBO") return "COMBO";
  return rule.type === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
}

/**
 * A combo's reward, chosen separately from the kind — "15% off the combo",
 * "R$ 5,00 off the combo" and "the combo for R$ 120" (FUT-4417) are the same
 * kind of promotion with different arithmetic. In the order the toggle shows
 * them.
 */
export const COMBO_REWARDS = ["PERCENTAGE", "FIXED_AMOUNT", "BUNDLE_PRICE"] as const;
export type ComboReward = (typeof COMBO_REWARDS)[number];

/** Which reward an existing combo was saved with; a new one starts on the percentage. */
export function comboRewardOf(rule: { type: string } | null): ComboReward {
  if (rule?.type === "FIXED_AMOUNT" || rule?.type === "BUNDLE_PRICE") return rule.type;
  return "PERCENTAGE";
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
export function typeAndScopeFor(values: { kind: string; comboReward: string; scope: string }): {
  type: DiscountType;
  scope: DiscountScope;
} {
  if (values.kind === "COMBO")
    return {
      type: comboRewardOf({ type: values.comboReward }),
      scope: "COMBO",
    };
  if (values.kind === "FREE_UNITS") return { type: "FREE_UNITS", scope: "COMBO" };
  const type = values.kind === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
  return {
    type,
    scope: values.scope === "COMBO" ? "ORDER" : (values.scope as DiscountScope),
  };
}
