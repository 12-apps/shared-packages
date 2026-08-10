/**
 * The visualization picker: a fixed grid of identical square tiles, and ONE
 * reason at a time (FUT-391, FUT-755).
 *
 * Two defects it answers, in order of how much they cost.
 *
 * **The reasons were a wall.** Every blocked option printed its sentence in a
 * stack below the grid — six lines in a 344px panel, five of them the same
 * sentence, taller than the control they explained. So a reason is now shown
 * only when it is ASKED FOR: hover, keyboard focus, or activating the tile,
 * one at a time, in the amber callout `prototype.html` renders (`.warn`).
 *
 * `plan.md` entry 14's acceptance is still "every disabled option has a
 * visible reason, not just a grey state", and a hover-only tooltip would
 * regress it for keyboard and touch. So the reason stays reachable four ways:
 * pointer hover, keyboard focus, activation, and — without any event at all —
 * as each blocked tile's accessible DESCRIPTION, via `title`.
 *
 * That is also why a blocked tile is `aria-disabled` and not `disabled`: a
 * genuinely disabled button is out of the tab order and swallows pointer
 * events in most browsers, so `disabled` would put the explanation behind an
 * interaction the very people who need it cannot perform. The click is a
 * no-op that explains itself instead.
 *
 * **The grid was ragged.** Tiles were laid out in a wrapping row, so their
 * width followed their label — "KPI (número único)" alone forced a 3-then-4
 * layout with one oversized cell. It is a fixed 4-column grid of identical
 * squares, and the copy is the prototype's (`Número`, not the parenthetical
 * that broke it).
 */
import { useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";

import type { ChartKind } from "./builder-model";
import { CONTROL_RADIUS_PX } from "./lib/report-surface";
import { VizIcon } from "./lib/viz-icons";

interface VizOption {
  value: ChartKind;
  label: string;
  disabledReason: string | null;
}

/** Four across, always — a tile's size must not follow its label's length. */
const GRID_SX = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 0.75,
} as const;

/**
 * One square, whatever it says. `aspect-ratio` is what makes the tile's height
 * follow its own width instead of its content, so "Número" and "Área" render
 * the same box; `minWidth: 0` stops the longest label widening its column.
 */
const TILE_SX = {
  aspectRatio: "1 / 0.86",
  minWidth: 0,
  width: "100%",
  minHeight: 0,
  flexDirection: "column",
  gap: 0.25,
  px: 0.5,
  py: 0.75,
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  lineHeight: 1.1,
} as const;

/** The label, at the caption step of the type scale, on one line. */
const TILE_LABEL_SX = {
  fontSize: "0.75rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
} as const;

/** Blocked tiles read as unavailable without leaving the tab order. */
const BLOCKED_SX = { ...TILE_SX, opacity: 0.45, cursor: "not-allowed" } as const;

/** The option whose reason is on screen, or null. */
function shownReason(
  options: VizOption[],
  kind: ChartKind | null,
): { value: ChartKind; label: string; text: string } | null {
  if (kind === null) return null;
  const option = options.find((candidate) => candidate.value === kind);
  if (!option || option.disabledReason === null) return null;
  return { value: option.value, label: option.label, text: option.disabledReason };
}

interface VizTileProps {
  option: VizOption;
  selected: boolean;
  /** Whether THIS tile's reason is the one currently on screen. */
  describing: boolean;
  testId: string;
  onPick: (option: VizOption) => void;
  onPeek: (kind: ChartKind | null) => void;
}

function VizTile({
  option,
  selected,
  describing,
  testId,
  onPick,
  onPeek,
}: VizTileProps): JSX.Element {
  const blocked = option.disabledReason !== null;
  return (
    <Button
      variant={selected ? "solid" : "outline"}
      size="sm"
      sx={blocked ? BLOCKED_SX : TILE_SX}
      aria-disabled={blocked || undefined}
      aria-pressed={selected}
      // The reason as the tile's accessible DESCRIPTION, with no event
      // required — a screen reader announces "Pizza, indisponível, <motivo>" on
      // arrival. `aria-describedby` points at the callout as well, but only
      // once it is on screen, and a description that exists only after a state
      // change is one an AT user may never hear.
      title={option.disabledReason ?? undefined}
      aria-describedby={describing ? `${testId}-${option.value}-reason` : undefined}
      onClick={() => onPick(option)}
      onMouseEnter={() => onPeek(blocked ? option.value : null)}
      onMouseLeave={() => onPeek(null)}
      onFocus={() => onPeek(blocked ? option.value : null)}
      onBlur={() => onPeek(null)}
      data-testid={`${testId}-${option.value}`}
    >
      <VizIcon kind={option.value} />
      <Box component="span" sx={TILE_LABEL_SX}>
        {option.label}
      </Box>
    </Button>
  );
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
  // Two states, because hovering away must not erase what you clicked to ask
  // about: `peeked` is the pointer/focus glance, `pinned` is the answer you
  // asked for, and the glance wins while it lasts.
  const [peeked, setPeeked] = useState<ChartKind | null>(null);
  const [pinned, setPinned] = useState<ChartKind | null>(null);
  const reason = shownReason(options, peeked ?? pinned);

  const pick = (option: VizOption): void => {
    if (option.disabledReason !== null) {
      setPinned(option.value);
      return;
    }
    setPinned(null);
    onChange(option.value);
  };

  return (
    <Box data-testid={testId}>
      <Box sx={GRID_SX}>
        {options.map((option) => (
          <VizTile
            key={option.value}
            option={option}
            selected={option.value === value}
            describing={reason?.value === option.value}
            testId={testId}
            onPick={pick}
            onPeek={setPeeked}
          />
        ))}
      </Box>

      {/* One callout, for the option in question — never a stack. `role="note"`
          and no live region on purpose: the focused tile already carries this
          same sentence as its description, and a polite live region would make
          a screen reader say it twice on every arrow key. */}
      {reason ? (
        <Alert
          variant="warning"
          showIcon={false}
          animate={false}
          role="note"
          aria-live="off"
          // `Alert` puts its root in the tab order; a sentence is not a stop.
          tabIndex={-1}
          id={`${testId}-${reason.value}-reason`}
          data-testid={`${testId}-${reason.value}-reason`}
          sx={{ mt: 1, fontSize: "0.75rem", py: 0.5 }}
        >
          {`${reason.label}: ${reason.text}`}
        </Alert>
      ) : null}
    </Box>
  );
}
