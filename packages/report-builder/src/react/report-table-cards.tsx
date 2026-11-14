/**
 * A table's opt-in phone form (FUT-4063): one stacked card per row — the name
 * and its supporting line on the left, the figure on the right — read as a
 * list. A flagged row keeps its warning tint, icon and words.
 */
import type { JSX } from "react";

import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { flaggedRowInk, flaggedRowTint } from "./lib/row-flag";
import { tableCard } from "./lib/table-cards";
import type { ReportPhoneCards, ReportRow, ReportTableColumn, ReportTableFlag } from "./reports-api";
import { useReportEngineCopy } from "./transport-context";

function FlagLine({ label }: { label: string }): JSX.Element {
  return (
    <Box
      component="div"
      data-report-row-flag=""
      sx={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 0.5,
        color: flaggedRowInk,
        fontWeight: "fontWeightBold",
        typography: "caption",
      }}
    >
      <Icon name="WarningAmber" size="sm" />
      {label}
    </Box>
  );
}

export function ReportTableCards({
  columns,
  rows,
  phone,
  flag,
  dataTestId,
}: {
  columns: readonly ReportTableColumn[];
  rows: ReportRow[];
  phone: ReportPhoneCards;
  flag?: ReportTableFlag;
  dataTestId: string;
}): JSX.Element {
  const copy = useReportEngineCopy();
  const flagged = new Set(flag?.rows ?? []);
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }} data-testid={`${dataTestId}-cards`}>
      {rows.map((row, index) => {
        const card = tableCard(row, columns, phone, copy.values);
        const isFlagged = flagged.has(index);
        return (
          <Box
            component="li"
            key={index}
            data-testid={`${dataTestId}-card-${index}`}
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 2,
              py: 1.5,
              px: 1,
              borderBottom: "1px solid",
              borderBottomColor: "divider",
              ...(isFlagged ? { bgcolor: flaggedRowTint } : {}),
            }}
          >
            <Stack sx={{ minWidth: 0 }} data-card-part="name">
              <Text as="div" variant="body" size="md" weight="semibold">
                {card.title}
              </Text>
              {card.subtitle ? (
                <Text as="div" variant="body" size="xs" color="secondary">
                  {card.subtitle}
                </Text>
              ) : null}
              {card.lines.map((line) => (
                <Text as="div" key={line.label} variant="body" size="xs" color="secondary">
                  {`${line.label}: ${line.value}`}
                </Text>
              ))}
            </Stack>
            <Stack
              sx={{ alignItems: "flex-end", textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
              data-card-part="figure"
            >
              {card.figure ? (
                <Text as="div" variant="body" size="md" weight="bold">
                  {card.figure.text}
                </Text>
              ) : null}
              {isFlagged && flag ? <FlagLine label={flag.label} /> : null}
              {card.figureCaption ? (
                <Text as="div" variant="body" size="xs" color="secondary">
                  {card.figureCaption}
                </Text>
              ) : null}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}
