"use client";

import Checkbox from "@mui/material/Checkbox";

import { useDataViewsCopy } from "./data-views-copy-context";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

/**
 * SELECT-ALL FOR THE LAYOUTS THAT HAVE NO HEADER ROW.
 *
 * The table gets this for free: its `<thead>` carries a checkbox, so beginning
 * a selection is one click on a control that sits with the rows it selects.
 * The cards, the list and the board have no header at all — so without this
 * there is NO way to start a selection except clicking an item first, and
 * "select everything on this page" costs one click per row.
 *
 * It is deliberately NOT more toolbar chrome. It sits directly above the
 * content it selects, which is exactly where the table's `<thead>` checkbox
 * sits; putting it in the toolbar would separate the control from its object
 * and would also be the third place in this component that renders a
 * select-all.
 *
 * Renders nothing for an empty page: a select-all over zero rows is a control
 * that cannot do anything, and reserving its band would make the empty state
 * sit lower in the cards than it does in the table.
 */
export function SelectAllStrip<T>({
  rows,
  getRowId,
  selectedIds,
  onChange,
  testIdPrefix,
}: {
  rows: T[];
  getRowId: (row: T) => string | number;
  selectedIds: Set<string | number>;
  onChange: (next: Set<string | number>) => void;
  testIdPrefix: string;
}): React.JSX.Element | null {
  const copy = useDataViewsCopy();
  if (rows.length === 0) return null;
  const pageIds = rows.map(getRowId);
  const selectedHere = pageIds.filter((id) => selectedIds.has(id)).length;
  const all = selectedHere === pageIds.length;
  // INDETERMINATE, not just checked/unchecked: with 3 of 25 selected, an
  // unchecked box says "nothing is selected" and a checked one says
  // "everything is". Both are wrong, and the third state is the honest one.
  const some = selectedHere > 0 && !all;

  const toggle = (): void => {
    if (all) {
      // Clear only THIS page's ids — a selection made on another page is not
      // this control's to discard.
      const next = new Set(selectedIds);
      pageIds.forEach((id) => next.delete(id));
      onChange(next);
      return;
    }
    onChange(new Set([...selectedIds, ...pageIds]));
  };

  return (
    <Box
      data-testid={`${testIdPrefix}-select-all-strip`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        mt: 1.5,
        px: 1,
        py: 0.75,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
        borderRadius: 1,
      }}
    >
      <Checkbox
        size="small"
        checked={all}
        indeterminate={some}
        onChange={toggle}
        data-testid={`${testIdPrefix}-select-all-box`}
        inputProps={{ "aria-label": copy.selection.selectAllOnPage }}
        sx={{ p: 0.5 }}
      />
      <Button
        variant="text"
        size="sm"
        color="secondary"
        onClick={toggle}
        dataTestId={`${testIdPrefix}-select-all-toggle`}
      >
        {all ? copy.selection.clearSelection : copy.selection.selectAll}
      </Button>
      <Text variant="caption" as="span">
        {/* "nesta página" is load-bearing: the scope tabs above show
            whole-query totals, so an unqualified count here would read as one. */}
        <Box component="span" sx={{ ml: "auto", color: "text.disabled", whiteSpace: "nowrap" }}>
          {copy.selection.onThisPage(rows.length)}
        </Box>
      </Text>
    </Box>
  );
}
