"use client";

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { Popover } from "@mui/material";
import { useState } from "react";

import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { fieldClearing, MoreGroup, type MoreFieldProps } from "./data-views-more-fields";
import type { OverflowField } from "./data-views-overflow";

/**
 * "MAIS" — the filter overflow: its trigger, its panel and its footer. What
 * goes INSIDE it is `data-views-more-fields`.
 *
 * It holds the fields that had no room on the toolbar. An applied filter is
 * ranked ahead of an idle one for the visible slots but is NOT exempt (see
 * `useFilterOverflow`), so an applied filter can be in here — on a phone, most
 * of them are. That is why the trigger changes tone and counts the applied
 * ones: a filter you cannot see is a filter you forget you set, and the badge
 * is what stops that.
 */

interface MoreFiltersProps<T extends Record<string, unknown>> extends MoreFieldProps {
  fields: OverflowField<T>[];
}

/**
 * The trigger, badged with how many fields had no room on the bar — and told
 * apart when some of them are APPLIED.
 *
 * An applied filter can land in here now (it is ranked first, not exempt), so
 * this button is the only thing on screen still saying it exists. A neutral
 * badge reading "3" would make "three filters you have not used" and "three
 * filters narrowing this list" look identical, which is the whole failure the
 * old exemption was written to avoid. So an overflow holding applied filters
 * takes the applied tone and counts them in its own badge.
 */
function MoreTrigger({
  count,
  appliedCount,
  compact,
  onOpen,
  testIdPrefix,
}: {
  count: number;
  appliedCount: number;
  /** Icon only — the same rung that strips Exibir/Exportar. */
  compact: boolean;
  onOpen: (anchor: HTMLElement) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const applied = appliedCount > 0;
  return (
    <Button
      variant="outline"
      size="sm"
      color="neutral"
      onClick={(event) => onOpen(event.currentTarget as HTMLElement)}
      dataTestId={`${testIdPrefix}-more-filters`}
      aria-label={
        applied
          ? `Mais filtros: ${count} sem espaço na barra, ${appliedCount} aplicado(s)`
          : `Mais filtros: ${count} sem espaço na barra`
      }
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          color: applied ? "primary.main" : undefined,
        }}
      >
        <TuneRoundedIcon fontSize="small" />
        {!compact && (
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Mais
          </Box>
        )}
        <Box
          component="span"
          data-testid={`${testIdPrefix}-more-badge`}
          sx={{
            px: 0.75,
            borderRadius: 5,
            bgcolor: applied ? "primary.main" : "action.selected",
            color: applied ? "primary.contrastText" : undefined,
            fontSize: "0.6875rem",
            fontWeight: applied ? 700 : undefined,
          }}
        >
          {applied ? appliedCount : count}
        </Box>
        {!compact && <KeyboardArrowDownRoundedIcon fontSize="small" />}
      </Box>
    </Button>
  );
}

/** The panel's heading: what these are, and why they are in here. */
function MoreHeading(): React.JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Text variant="caption" as="span">
        <Box component="span" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.disabled" }}>
          Mais filtros
        </Box>
      </Text>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ ml: "auto", color: "text.disabled" }}>
          sem espaço na barra
        </Box>
      </Text>
    </Box>
  );
}

/**
 * The panel's own way back to the unfiltered list.
 *
 * The bar's "Limpar" is the primary one, but it is a control like any other
 * and the ladder can take its label — and on the narrowest rungs this panel is
 * where most of the fields ended up anyway. Clearing everything from inside it
 * saves closing it to reach a button three pixels wide.
 */
function MoreFooter({
  onClearAll,
  testIdPrefix,
}: {
  onClearAll: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}>
      <Box
        component="button"
        type="button"
        onClick={onClearAll}
        data-testid={`${testIdPrefix}-more-clear-all`}
        sx={{
          width: "100%",
          border: 0,
          p: 0,
          bgcolor: "transparent",
          cursor: "pointer",
          font: "inherit",
          fontSize: "0.8125rem",
          textAlign: "left",
          color: "primary.main",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        Limpar todos os filtros
      </Box>
    </Box>
  );
}

/** The overflow trigger + panel. Renders nothing when everything fits. */
export function MoreFilters<T extends Record<string, unknown>>({
  fields,
  onOpenChange,
  onClearAll,
  anyApplied,
  compact = false,
  ...rest
}: MoreFiltersProps<T> & {
  /** Icon only — the same rung that strips Exibir/Exportar. */
  compact?: boolean;
  /** Clears every filter, not just the ones in here. */
  onClearAll: () => void;
  /** Whether anything is applied anywhere — the footer is pointless otherwise. */
  anyApplied: boolean;
  /**
   * So the shell can FREEZE the measured split while this panel is open.
   *
   * Applying a filter in here makes its field active, and an active field
   * takes an inline slot first — so the field being edited was promoted OUT of
   * this panel mid-keystroke, taking the focused input with it. Typing "12"
   * got as far as "1" and then had nowhere to go.
   */
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (fields.length === 0) return null;
  return (
    <>
      <MoreTrigger
        count={fields.length}
        appliedCount={
          fields.filter(
            (field) =>
              fieldClearing({
                field,
                pills: rest.pills,
                ranges: rest.ranges,
                onTogglePill: rest.onTogglePill,
                onChangeRange: rest.onChangeRange,
              }).applied,
          ).length
        }
        compact={compact}
        onOpen={(element) => {
          setAnchor(element);
          onOpenChange?.(true);
        }}
        testIdPrefix={rest.testIdPrefix}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          onOpenChange?.(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box data-testid={`${rest.testIdPrefix}-more-panel`}>
          <MoreHeading />
          <Box sx={{ maxHeight: 320, overflowY: "auto", p: 1.5 }}>
            {fields.map((field) => (
              <MoreGroup key={field.id} field={field} {...rest} />
            ))}
          </Box>
          {anyApplied && (
            <MoreFooter onClearAll={onClearAll} testIdPrefix={rest.testIdPrefix} />
          )}
        </Box>
      </Popover>
    </>
  );
}
