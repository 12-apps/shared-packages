"use client";

import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
// A FUNNEL, not the tune sliders this used to share with "Exibir". The two
// sit a few px apart on the same bar and do unrelated things — one narrows
// WHICH rows you see, the other changes HOW they are shown — and with one
// glyph between them the bar offered the operator no way to tell which was
// which. On a phone, where both are icon-only, they were indistinguishable.
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import Popover from "@mui/material/Popover/index.js";
import { useTheme, type Theme } from "@mui/material/styles/index.js";
import useMediaQuery from "@mui/material/useMediaQuery/index.js";


import { useDataViewsCopy } from "./data-views-copy-context";
import { Button } from "../../form/Button";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { fieldClearing, MoreGroup, MoreQuick, type MoreFieldProps } from "./data-views-more-fields";
import { useStillAnchor } from "./data-views-still-anchor";
import type { OverflowField } from "./data-views-overflow";
import { rem, remPx, sxRem } from "../../../tokens/relative";

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
  const copy = useDataViewsCopy();
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
          ? copy.filters.moreFiltersApplied(count, appliedCount)
          : copy.filters.moreFilters(count)
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
        <FilterAltRoundedIcon fontSize="small" />
        {!compact && (
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            {copy.filters.moreTriggerLabel}
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
            fontSize: sxRem(11),
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
  const copy = useDataViewsCopy();
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
        <Box component="span" sx={{ textTransform: "uppercase", letterSpacing: sxRem(0.5), color: "text.disabled" }}>
          {copy.filters.moreHeading}
        </Box>
      </Text>
      <Text variant="caption" as="span">
        <Box component="span" sx={{ ml: "auto", color: "text.disabled" }}>
          {copy.filters.overflowNote}
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
  reserved = false,
}: {
  onClearAll: () => void;
  testIdPrefix: string;
  /**
   * Hold the footer's height with nothing in it. A panel holding a day range
   * keeps the row while nothing is applied, so the first tap on its calendar
   * does not grow the panel by a row and move its top under the finger
   * (FUT-4144 UI review).
   */
  reserved?: boolean;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  return (
    <Box
      aria-hidden={reserved || undefined}
      // Held, the row is blank — no rule over it either, or it reads as an
      // empty bordered row.
      sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: reserved ? "transparent" : "divider", visibility: reserved ? "hidden" : undefined }}
    >
      <Box
        component="button"
        type="button"
        onClick={reserved ? undefined : onClearAll}
        tabIndex={reserved ? -1 : undefined}
        data-testid={reserved ? undefined : `${testIdPrefix}-more-clear-all`}
        sx={{
          width: "100%",
          border: 0,
          p: 0,
          bgcolor: "transparent",
          cursor: "pointer",
          font: "inherit",
          fontSize: sxRem(13),
          textAlign: "left",
          color: "primary.main",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        {copy.filters.clearAll}
      </Box>
    </Box>
  );
}

/** The panel's body: a shed quick chip as a toggle row, anything else as a labelled group. */
function MoreFields<T extends Record<string, unknown>>({
  fields,
  ...rest
}: MoreFiltersProps<T>): React.JSX.Element {
  return (
    <>
      {fields.map((field) =>
        field.quick ? (
          <MoreQuick key={field.id} quick={field.quick} {...rest} />
        ) : (
          <MoreGroup key={field.id} field={field} {...rest} />
        ),
      )}
    </>
  );
}

/**
 * The panel is a column: heading, the fields' scroller, footer. Its height is
 * the screen's, not a fixed 320px — at 390×844 that cap scrolled a day range's
 * month caption and weekday row out of view after the first tap, and a typed
 * day's refusal out of sight of its box (FUT-4144 UI review). MUI moves the
 * panel up when it is taller than the room under its trigger.
 */
const COLUMN_SX = { display: "flex", flexDirection: "column" } as const;

/**
 * 320, not 300: inside 12px of padding a day range's month then has the 280px
 * its seven 40px columns need and its month/year caption one row (FUT-4144).
 */
const PAPER_SX = (theme: Theme) => ({
  ...COLUMN_SX,
  width: rem(theme, 320),
  maxWidth: `calc(100vw - ${rem(theme, 32)})`,
});

/**
 * Below `sm` the panel takes the screen's width less 8px each side, so a day
 * range's calendar gets the 280px its seven 40px columns need (it had 264 at
 * 320 and 276 at 390, so every day was a 34-36px target).
 */
const PHONE_PAPER_SX = (theme: Theme) => ({
  ...COLUMN_SX,
  width: `calc(100vw - ${rem(theme, 16)})`,
  maxWidth: `calc(100vw - ${rem(theme, 16)})`,
  maxHeight: `calc(100% - ${rem(theme, 16)})`,
});

/** Props of {@link MoreFilters}. */
interface MoreFiltersPanelProps<T extends Record<string, unknown>> extends MoreFiltersProps<T> {
  /** Changes on every clear-all; the fields here are keyed on it (FUT-4144). */
  clearKey?: number;
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
}

/** The overflow trigger + panel. Renders nothing when everything fits. */
export function MoreFilters<T extends Record<string, unknown>>({
  fields,
  onOpenChange,
  onClearAll,
  anyApplied,
  compact = false,
  clearKey,
  ...rest
}: MoreFiltersPanelProps<T>): React.JSX.Element | null {
  const still = useStillAnchor();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  if (fields.length === 0) return null;
  const holdsDayRange = fields.some((field) => field.range?.kind === "day");
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
          still.open(element);
          onOpenChange?.(true);
        }}
        testIdPrefix={rest.testIdPrefix}
      />
      <Popover
        {...still.popoverProps}
        onClose={() => {
          still.close();
          onOpenChange?.(false);
        }}
        // Below `sm`, 8px from the screen's edges instead of 16.
        marginThreshold={phone ? remPx(theme, 8) : undefined}
        slotProps={{ paper: { ref: still.paperRef, sx: phone ? PHONE_PAPER_SX : PAPER_SX } }}
      >
        <Box data-testid={`${rest.testIdPrefix}-more-panel`} sx={{ ...COLUMN_SX, flex: "1 1 auto", minHeight: 0 }}>
          <MoreHeading />
          {/* overflowX hidden, not auto: this panel is a fixed width and its
              contents are told to shrink into it. A horizontal scrollbar here
              means something refused to, which is a bug to fix rather than a
              scrollbar to live with. */}
          <Box sx={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", p: { xs: 1, sm: 1.5 }, minWidth: 0 }}>
            <MoreFields key={clearKey} fields={fields} {...rest} />
          </Box>
          {(anyApplied || holdsDayRange) && (
            <MoreFooter onClearAll={onClearAll} testIdPrefix={rest.testIdPrefix} reserved={!anyApplied} />
          )}
        </Box>
      </Popover>
    </>
  );
}
