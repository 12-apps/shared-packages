"use client";

/**
 * THE TWO BARE AFFORDANCES ON THE FILTER BAR.
 *
 * Neither opens anything, which is what sets them apart from every other
 * control on that row and why they are styled flat rather than as outlined
 * pills: one clears the filters, one leaves a search takeover. Giving them a
 * pill's weight made "Limpar" read as a sixth filter.
 *
 * Their own module because `data-views-inline-bar` outgrew the file-size gate.
 */
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import FilterAltOffRoundedIcon from "@mui/icons-material/FilterAltOffRounded";
import { Tooltip } from "@mui/material";

import { Box } from "../../../mui/Box";
import { useDataViewsCopy } from "./data-views-copy-context";

/**
 * "Limpar" — one gesture back to the unfiltered list.
 *
 * Present ONLY while something is applied, and last in the cluster, because it
 * is destructive and must never be where a filter control was a moment ago.
 * Each pill already carries its own ✕; this is the other job — six applied
 * filters is six ✕ hunts, and the operator who wants "show me everything
 * again" has no way to say it.
 *
 * Loses its label on the same rung Exibir/Exportar lose theirs, and keeps a
 * tooltip when it does: it is one of the two controls (with the search) whose
 * icon has to carry the whole meaning on a phone.
 */
export function ClearAllControl({
  onClearAll,
  compact,
  testIdPrefix,
}: {
  onClearAll: () => void;
  compact: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  // No border, no fill. Every other control on this row is an outlined pill
  // because it OPENS something; this one is an escape hatch, and giving it the
  // same weight made it read as a sixth filter. Quiet until hovered.
  const button = (
    <Box
      component="button"
      type="button"
      onClick={onClearAll}
      data-testid={`${testIdPrefix}-clear-all`}
      aria-label={copy.filters.clearAll}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        height: 34,
        px: compact ? 0.75 : 1,
        border: 0,
        borderRadius: 1,
        bgcolor: "transparent",
        cursor: "pointer",
        font: "inherit",
        fontSize: "0.8125rem",
        whiteSpace: "nowrap",
        color: "text.secondary",
        "&:hover": { color: "text.primary", bgcolor: "action.hover" },
      }}
    >
      <FilterAltOffRoundedIcon sx={{ fontSize: 16 }} />
      {!compact && <Box component="span">{copy.filters.clear}</Box>}
    </Box>
  );
  return compact ? <Tooltip title={copy.filters.clearAll}>{button}</Tooltip> : button;
}

/**
 * The way out of a search takeover.
 *
 * A phone has no Escape key, and without this the takeover is a one-way door
 * onto a bar with no filters on it.

/**
 * The way out of a search takeover.
 *
 * A phone has no Escape key, and without this the takeover is a one-way door
 * onto a bar with no filters on it.
 */
export function CloseSearchControl({
  onClose,
  testIdPrefix,
}: {
  onClose: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Tooltip title={copy.search.close}>
      <Box
        component="button"
        type="button"
        onClick={onClose}
        aria-label={copy.search.close}
        data-testid={`${testIdPrefix}-search-close`}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          height: 34,
          px: 0.75,
          border: 0,
          borderRadius: 1,
          bgcolor: "transparent",
          cursor: "pointer",
          color: "text.secondary",
          "&:hover": { color: "text.primary", bgcolor: "action.hover" },
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 18 }} />
      </Box>
    </Tooltip>
  );
}
