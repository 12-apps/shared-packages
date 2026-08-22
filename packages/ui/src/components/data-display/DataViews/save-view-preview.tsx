"use client";

/**
 * What a saved view actually GUARDS, listed before it is saved.
 *
 * Split out of `SaveViewModal.tsx` when that file crossed the size gate: this
 * is the one self-contained piece of it — a read-only summary of the view
 * state, with no form and no dialog around it.
 */
import { useDataViewsCopy } from "./data-views-copy-context";
import { Box } from "../../../mui/Box";
import { Stack } from "../../../mui/Stack";
import { Text } from "../../typography/Text";

export interface PreviewBoxProps {
  preview: { filters: string[]; columns: string[]; sort: string[] };
  testIdPrefix: string;
}

/** One "label — value" line of the summary. */
function SummaryRow({
  label,
  items,
  testId,
}: {
  label: string;
  items: string[];
  testId: string;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Box sx={{ display: "flex", gap: 1.5 }} data-testid={testId}>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ width: 116, flexShrink: 0, color: "text.secondary" }}>
          {label}
        </Box>
      </Text>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
          {items.join(", ")}
        </Box>
      </Text>
    </Box>
  );
}

export function PreviewBox({ preview, testIdPrefix }: PreviewBoxProps): React.JSX.Element {
  const copy = useDataViewsCopy();
  const empty =
    preview.filters.length === 0 && preview.columns.length === 0 && preview.sort.length === 0;
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover", border: (theme) => `1px solid ${theme.palette.divider}` }}>
      <Text variant="caption" as="p">
        <Box
          component="span"
          sx={{ display: "block", mb: 1, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, color: "text.disabled" }}
        >
          {copy.saveView.previewHeading}
        </Box>
      </Text>
      {empty ? (
        // Saving is still allowed — an operator may be naming the default on
        // purpose — but it should not be a surprise afterwards.
        <Text variant="caption" as="p">
          <Box component="span" sx={{ color: "warning.main", lineHeight: 1.6 }} data-testid={`${testIdPrefix}-preview-empty`}>
            {copy.saveView.previewUnchanged}
          </Box>
        </Text>
      ) : (
        <Stack spacing={0.75}>
          <SummaryRow label={copy.saveView.previewFilters} items={preview.filters} testId={`${testIdPrefix}-preview-filters`} />
          <SummaryRow label={copy.saveView.previewHiddenColumns} items={preview.columns} testId={`${testIdPrefix}-preview-columns`} />
          <SummaryRow label={copy.saveView.sortRowLabel} items={preview.sort} testId={`${testIdPrefix}-preview-sort`} />
        </Stack>
      )}
    </Box>
  );
}
