import { fill, type DiscountsWebCopy } from "./copy";
import type { ComboPreview, ComboRewardValue } from "./combo-preview";
import type { DiscountsFormatters } from "./format";

/**
 * The preview's sentences (FUT-4417), from the figures `comboPreviewOf` worked
 * out. Pure, so every branch below is a unit test rather than a screenshot.
 *
 * Two layouts say the same thing in two shapes, as the approved prototype
 * draws them:
 *
 * - **inline** — under the reward's field, on a phone or a narrow form: two
 *   lines, the second carrying the whole range ("Cliente paga de R$ 121,05 a
 *   R$ 143,55 (10% a menos)");
 * - **aside** — its own column beside a wide form: the second line short and
 *   emphasised ("Cliente paga 10% a menos"), and a third line of examples at
 *   both ends of a one-group combo ("Exemplos: 5 de Frango → R$ 121,05 · …").
 *
 * The first line is ONE wording for every reward ("5 itens somam de … a …").
 * The prototype's phone frame said "Itens: de … a …" under the two discounts
 * and "5 marmitas somam…" under the closed price; the data has no noun like
 * "marmitas" for a group, so the pack's own counted noun stands in for both.
 */
export type ComboPreviewLayout = "inline" | "aside";

export interface ComboPreviewLines {
  items: string;
  /** What the buyer pays; null while the reward's value is not typed. */
  pays: string | null;
  /** The aside's example line; null inline, for several groups, or when both ends cost the same. */
  examples: string | null;
}

interface Say {
  copy: DiscountsWebCopy;
  money: (cents: number) => string;
}

function itemsLine(preview: ComboPreview, say: Say): string {
  const { combo, comboRewards } = say.copy;
  const units = fill(preview.units === 1 ? combo.unitsOne : combo.unitsOther, {
    count: preview.units,
  });
  const { cheapest, dearest } = preview;
  return cheapest.groupCents === dearest.groupCents
    ? fill(comboRewards.preview.itemsExact, {
        units,
        sum: say.money(cheapest.groupCents),
      })
    : fill(comboRewards.preview.itemsRange, {
        units,
        min: say.money(cheapest.groupCents),
        max: say.money(dearest.groupCents),
      });
}

/** "10%" or "R$ 15,00": what a discount reward takes off, as the operator typed it. */
function offOf(reward: ComboRewardValue, formatters: DiscountsFormatters): string {
  return reward.type === "PERCENTAGE"
    ? formatters.percent(reward.percentOffBp)
    : formatters.money(reward.amountOffCents);
}

/** The two discounts: a range of what is paid, or the reward itself in the aside. */
function discountPays(
  preview: ComboPreview,
  reward: ComboRewardValue,
  layout: ComboPreviewLayout,
  say: Say,
  off: string,
): string {
  const words = say.copy.comboRewards.preview;
  if (layout === "aside") return fill(words.paysOff, { off });
  const { cheapest, dearest } = preview;
  const rate = reward.type === "PERCENTAGE";
  if (cheapest.paysCents === dearest.paysCents) {
    const pays = say.money(cheapest.paysCents);
    return rate ? fill(words.paysExactOff, { pays, off }) : fill(words.paysExact, { pays });
  }
  const range = {
    min: say.money(cheapest.paysCents),
    max: say.money(dearest.paysCents),
  };
  return rate ? fill(words.paysRangeOff, { ...range, off }) : fill(words.paysRange, range);
}

/** The closed price, in the three places it can sit against the items' range. */
function pricePays(
  preview: ComboPreview,
  price: number,
  layout: ComboPreviewLayout,
  say: Say,
): string {
  const words = say.copy.comboRewards.preview;
  const { cheapest, dearest } = preview;
  const priced = say.money(price);
  // At or above the dearest sum the engine charges the items (`max(0, …)`).
  if (dearest.savingCents === 0) return words.noSaving;
  if (cheapest.savingCents > 0 || cheapest.groupCents === price) {
    if (layout === "aside") return fill(words.paysExact, { pays: priced });
    if (cheapest.savingCents === 0) {
      return fill(words.paysPriceSavingUpTo, {
        price: priced,
        max: say.money(dearest.savingCents),
      });
    }
    return cheapest.savingCents === dearest.savingCents
      ? fill(words.paysPriceSavingExact, {
          price: priced,
          saving: say.money(dearest.savingCents),
        })
      : fill(words.paysPriceSaving, {
          price: priced,
          min: say.money(cheapest.savingCents),
          max: say.money(dearest.savingCents),
        });
  }
  // Between the two: the cheapest combo costs its items, the dearest the price.
  const min = say.money(cheapest.paysCents);
  return layout === "aside"
    ? fill(words.paysRange, { min, max: priced })
    : fill(words.paysUpToPrice, {
        min,
        price: priced,
        max: say.money(dearest.savingCents),
      });
}

function examplesLine(preview: ComboPreview, reward: ComboRewardValue, say: Say): string | null {
  const { single, cheapest, dearest } = preview;
  if (single === null || cheapest.groupCents === dearest.groupCents) return null;
  const words = say.copy.comboRewards.preview;
  const example = (name: string, end: typeof cheapest): string => {
    const values = {
      quantity: single.quantity,
      name,
      pays: say.money(end.paysCents),
    };
    return reward.type === "BUNDLE_PRICE" && end.savingCents > 0
      ? fill(words.exampleSaving, {
          ...values,
          saving: say.money(end.savingCents),
        })
      : fill(words.example, values);
  };
  return fill(words.examples, {
    cheapest: example(single.cheapestName, cheapest),
    dearest: example(single.dearestName, dearest),
  });
}

export function comboPreviewLines(
  preview: ComboPreview,
  reward: ComboRewardValue,
  layout: ComboPreviewLayout,
  copy: DiscountsWebCopy,
  formatters: DiscountsFormatters,
): ComboPreviewLines {
  const say: Say = { copy, money: (cents) => formatters.money(cents) };
  const items = itemsLine(preview, say);
  if (!preview.rewardTyped) return { items, pays: null, examples: null };
  const pays =
    reward.type === "BUNDLE_PRICE"
      ? pricePays(preview, reward.bundlePriceCents ?? 0, layout, say)
      : discountPays(preview, reward, layout, say, offOf(reward, formatters));
  return {
    items,
    pays,
    examples: layout === "aside" ? examplesLine(preview, reward, say) : null,
  };
}
