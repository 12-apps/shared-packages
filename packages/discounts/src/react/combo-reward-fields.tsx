"use client";

import { useRef, type JSX } from "react";

import { Fields, useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { DiscountsWebCopy } from "./copy";
import { InlineComboCartPreview } from "./combo-cart-preview";
import type { CurrencyFieldComponent } from "./discount-form-fields";
import { COMBO_REWARDS, comboRewardOf } from "./form-kind";
import { useElementWidth } from "./kind-field";
import { PercentField } from "./number-fields";

/**
 * A combo's reward: which of the three, how much, and what it comes to in the
 * cart (FUT-4417).
 *
 * All of it is here rather than split between the top of the form and the
 * bottom, because to a merchant it is one sentence — "este combo dá 15% de
 * desconto", "…sai por R$ 120". "Preço fechado" is the third choice: the
 * matched group costs exactly the price typed, whatever its items cost. That
 * used to be refused as a choice because it goes on charging the same when an
 * item's price changes — which is the point of a closed price, so the hint says
 * it in those words and the preview shows it against the store's real prices.
 *
 * **One line at every width** (ADR 0190 in the host), like the kind question
 * (`./kind-field`): a segmented control of three equal parts where they fit,
 * the same field as a select where they do not. The value's field sits beside
 * the choices where both fit on one row, and under them otherwise.
 */

/**
 * The widest pt-BR reward label at the toggle's type size plus its padding, per
 * label: "Porcentagem" is the widest, as it is in the kind toggle (132 px
 * measured there). Parts are equal, so the widest one sizes all three.
 */
const REWARD_PART_MIN_PX: Readonly<Record<(typeof COMBO_REWARDS)[number], number>> = {
  PERCENTAGE: 136,
  FIXED_AMOUNT: 104,
  BUNDLE_PRICE: 128,
};

/** The gap between the choices and the value's field, `gap: 2`. */
const ROW_GAP_PX = 16;

const NEEDED_PX =
  COMBO_REWARDS.length * Math.max(...COMBO_REWARDS.map((reward) => REWARD_PART_MIN_PX[reward]));

/** The value's input for the chosen reward; the other two are unmounted (`discounts_value_check`). */
function RewardValueField({
  reward,
  copy,
  currencyField,
}: {
  reward: string;
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  const Currency = currencyField;
  if (reward === "BUNDLE_PRICE")
    return <Currency name="bundlePrice" label={copy.form.bundlePrice} />;
  if (reward === "FIXED_AMOUNT") return <Currency name="amountOff" label={copy.form.amountOff} />;
  return <PercentField copy={copy} />;
}

export function ComboRewardFields({
  copy,
  currencyField,
}: {
  copy: DiscountsWebCopy;
  currencyField: CurrencyFieldComponent;
}): JSX.Element {
  const { values } = useFormContext();
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const reward = comboRewardOf({ type: values.comboReward ?? "" });
  const options = COMBO_REWARDS.map((value) => ({
    value,
    label: copy.comboRewards.labels[value],
  }));
  const sideBySide = width === null || width >= 2 * NEEDED_PX + ROW_GAP_PX;
  const column = width === null ? null : sideBySide ? (width - ROW_GAP_PX) / 2 : width;
  const fits = column === null || column >= NEEDED_PX;
  return (
    <Stack spacing={0.5} ref={box} sx={{ minWidth: 0 }}>
      <Box
        data-testid="combo-reward-row"
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: sideBySide ? "1fr 1fr" : "1fr",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {fits ? (
            <Fields.ToggleField
              name="comboReward"
              label={copy.form.comboReward}
              options={options}
            />
          ) : (
            <Fields.SelectField
              name="comboReward"
              label={copy.form.comboReward}
              options={options}
            />
          )}
        </Box>
        <RewardValueField reward={reward} copy={copy} currencyField={currencyField} />
      </Box>
      <Text variant="caption" data-testid="combo-reward-hint">
        {copy.comboRewards.hints[reward]}
      </Text>
      <InlineComboCartPreview />
    </Stack>
  );
}
