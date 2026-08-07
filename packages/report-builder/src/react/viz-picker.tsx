/**
 * The visualization picker as an icon grid (FUT-391).
 *
 * It replaced a `<Select>` whose unavailable options were merely greyed. Grey
 * says "no" without saying why, so an author whose pie chart is disabled has
 * to guess which of their choices caused it — and the compiler already KNOWS:
 * `presentationCompatibility` returns a pt-BR reason per option.
 *
 * So every blocked option carries its reason as visible text, not a tooltip.
 * A tooltip is unreachable on touch, and this is the one place the product has
 * to explain a rule rather than merely enforce it.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ChartKind } from "./builder-model";
import { VizIcon } from "./lib/viz-icons";

interface VizOption {
  value: ChartKind;
  label: string;
  disabledReason: string | null;
}

/**
 * The reasons the picker must SHOW: one per blocked option, labelled with the
 * option it belongs to.
 *
 * Extracted because it is the plan's actual acceptance criterion — "every
 * disabled option has a visible reason, not just a grey state" — and the
 * package has no DOM test environment, so a rule left inside the JSX would be
 * asserted nowhere.
 */
export function blockedReasons(
  options: VizOption[],
): Array<{ value: ChartKind; text: string }> {
  return options
    .filter((option) => option.disabledReason !== null)
    .map((option) => ({ value: option.value, text: `${option.label}: ${option.disabledReason}` }));
}

export function VizPicker({
  options,
  value,
  onChange,
  testId = "builder-chart-type",
}: {
  options: VizOption[];
  value: ChartKind;
  onChange: (kind: ChartKind) => void;
  testId?: string;
}): JSX.Element {
  return (
    <Stack spacing={1} data-testid={testId}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        {options.map((option) => {
          const blocked = option.disabledReason !== null;
          return (
            <Button
              key={option.value}
              variant={option.value === value ? "solid" : "outline"}
              size="sm"
              disabled={blocked}
              aria-pressed={option.value === value}
              // The reason is rendered below as well; naming it here means a
              // screen reader hears WHY the control is unavailable at the
              // moment it lands on it, rather than only if it reads on.
              aria-describedby={blocked ? `${testId}-${option.value}-reason` : undefined}
              onClick={() => onChange(option.value)}
              data-testid={`${testId}-${option.value}`}
            >
              <Stack spacing={0.5} sx={{ alignItems: "center" }}>
                <VizIcon kind={option.value} />
                <span>{option.label}</span>
              </Stack>
            </Button>
          );
        })}
      </Stack>

      {/* Every blocked option's reason, visible — the plan's acceptance is
          that a disabled type is explained, not merely grey. */}
      {blockedReasons(options).map((reason) => (
        <Text
          key={reason.value}
          variant="body"
          size="xs"
          color="secondary"
          id={`${testId}-${reason.value}-reason`}
          data-testid={`${testId}-${reason.value}-reason`}
        >
          {reason.text}
        </Text>
      ))}
    </Stack>
  );
}
