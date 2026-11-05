import type { ComboReward } from "./form-kind";

/**
 * The combo reward's words (FUT-4417): the three choices, the sentence under
 * each, and "Como fica no carrinho" — what the group's items sum to and what
 * the buyer pays for them under this reward.
 *
 * A group of its own rather than more `form` keys because the preview is a
 * small grammar of its own: which sentence is said depends on the reward, on
 * whether the items' prices are one figure or a range, and on whether the form
 * is wide enough to put the preview in its own column (where it reads in short
 * sentences plus an example line) or under the field (one sentence carrying
 * the range). Each placeholder is a figure the package has already formatted.
 */
export interface DiscountsComboPreviewCopy {
  /** The box's heading. */
  readonly title: string;
  /** `{units}` ("5 itens"), `{min}`, `{max}`: what one combo's items sum to. */
  readonly itemsRange: string;
  /** The same when every item the groups can take costs the same. `{units}`, `{sum}`. */
  readonly itemsExact: string;
  /** `{min}`, `{max}`: what the buyer pays, as a range. */
  readonly paysRange: string;
  /** `{min}`, `{max}`, `{off}` (the rate, "10%"): the percentage's range, under the field. */
  readonly paysRangeOff: string;
  /** `{pays}`: one figure. */
  readonly paysExact: string;
  /** `{pays}`, `{off}`: one figure, at a rate. */
  readonly paysExactOff: string;
  /** `{off}` — "10%" or "R$ 15,00": the reward itself, in the wide layout. */
  readonly paysOff: string;
  /** Closed price under every items sum: `{price}`, `{min}`, `{max}` (the saving's range). */
  readonly paysPriceSaving: string;
  /** The same with one saving figure: `{price}`, `{saving}`. */
  readonly paysPriceSavingExact: string;
  /** Closed price between the cheapest and dearest sums: `{min}`, `{price}`, `{max}` (most saved). */
  readonly paysUpToPrice: string;
  /** Closed price at or above the dearest sum: nothing is saved. */
  readonly noSaving: string;
  /** The wide layout's third line: `{cheapest}` and `{dearest}`, each an `example`. */
  readonly examples: string;
  /** `{quantity}`, `{name}` (as the catalog stores it), `{pays}`. */
  readonly example: string;
  /** The same with what it saves: `{quantity}`, `{name}`, `{pays}`, `{saving}`. */
  readonly exampleSaving: string;
}

export interface DiscountsComboRewardsCopy {
  /** The toggle's three choices, in `COMBO_REWARDS` order. */
  readonly labels: Readonly<Record<ComboReward, string>>;
  /** The sentence under the reward's field, one per choice. */
  readonly hints: Readonly<Record<ComboReward, string>>;
  readonly preview: DiscountsComboPreviewCopy;
}
