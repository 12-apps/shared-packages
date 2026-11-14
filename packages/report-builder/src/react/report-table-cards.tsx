/**
 * A table's opt-in phone form (FUT-4063): one stacked card per row — the name
 * and its supporting line on the left, the figure on the right — read as a
 * list. A flagged row keeps its warning tint, icon and words.
 */
import type { JSX } from "react";

import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/mui/Box";
import { alpha, type Theme } from "@12-apps/ui/mui/styles";
import { Text } from "@12-apps/ui/typography/Text";

import { tableCard } from "./lib/table-cards";
import type { ReportPhoneCards, ReportRow, ReportTableColumn, ReportTableFlag } from "./reports-api";
import { useReportEngineCopy } from "./transport-context";

function FlagLine({ label }: { label: string }): JSX.Element {
  return (
    <Box
      component="span"
      data-report-row-flag=""
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        color: "warning.dark",
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
              ...(isFlagged ? { bgcolor: (theme: Theme) => alpha(theme.palette.warning.main, 0.12) } : {}),
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Text variant="body" size="md" weight="semibold">
                {card.title}
              </Text>
              {card.subtitle ? (
                <Text variant="body" size="xs" color="secondary">
                  {card.subtitle}
                </Text>
              ) : null}
              {card.lines.map((line) => (
                <Text key={line.label} variant="body" size="xs" color="secondary">
                  {`${line.label}: ${line.value}`}
                </Text>
              ))}
            </Box>
            <Box sx={{ textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {card.figure ? (
                <Text variant="body" size="md" weight="bold">
                  {card.figure.text}
                </Text>
              ) : null}
              {isFlagged && flag ? <FlagLine label={flag.label} /> : null}
              {card.figureCaption ? (
                <Text variant="body" size="xs" color="secondary">
                  {card.figureCaption}
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
