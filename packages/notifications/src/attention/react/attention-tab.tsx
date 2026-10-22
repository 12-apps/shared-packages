/**
 * The folded button's tab: a half disc flush with the screen's edge, halfway
 * down the right one until the reader drags it (`./attention-collapsible`).
 *
 * A press that travels is a drag: the tab follows the pointer as a round
 * bubble, anywhere on the screen. Let go within {@link SNAP_PX} of a side, it
 * goes flush with that side as a half disc again; let go anywhere else, it
 * stays there, a bubble. A press that does not travel is a tap, and opens the
 * button.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';

import type { AttentionPulse, AttentionSeverity } from '../core';

import { HALO_SX, halos, severityFill, severityInk } from './attention-button';
import type { AttentionDockPosition } from './preferences';
import { useDockDrag, type DockDrop, type DockFit } from './use-dock-drag';

/**
 * How far the half disc reaches into the page: half its height. Wide enough to
 * be seen at a glance and to hold two digits — a thinner tab was missed.
 */
const TAB_WIDTH_PX = 28;
const TAB_HEIGHT_PX = TAB_WIDTH_PX * 2;

/** Flush with the edges it is dragged against; its `y` is a share of the screen less its own height. */
const TAB_FIT: DockFit = { margin: 0, span: TAB_HEIGHT_PX, captureOnPress: true };

/** The tab away from an edge: a round bubble, big enough for two digits and a thumb. */
const BUBBLE_PX = 44;

/** Let go this close to a side, the tab goes flush with it rather than floating. */
const SNAP_PX = 24;

/** Where a tab nobody dragged rests: halfway down the right edge. */
export const TAB_REST: AttentionDockPosition = { side: 'right', y: 0.5 };

const STAY = (): void => undefined;

const clampShare = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Where a drag let the tab go: flush with a side when it was dropped near one,
 * else the bubble's spot, its top-left as a share of the screen less its size.
 * Measured from the bubble's centre, which is what the pointer held.
 */
function tabSpotFor(edge: AttentionDockPosition, drop: DockDrop): AttentionDockPosition {
  const left = drop.left + drop.width / 2 - BUBBLE_PX / 2;
  const top = drop.top + drop.height / 2 - BUBBLE_PX / 2;
  if (left < SNAP_PX || left + BUBBLE_PX > window.innerWidth - SNAP_PX) {
    return { side: edge.side, y: clampShare(top / Math.max(1, window.innerHeight - TAB_HEIGHT_PX)) };
  }
  return {
    side: edge.side,
    y: clampShare(top / Math.max(1, window.innerHeight - BUBBLE_PX)),
    x: clampShare(left / Math.max(1, window.innerWidth - BUBBLE_PX)),
  };
}

/** The most the tab prints: two digits; past it, "99+" (the label says the number). */
const TAB_MAX = 99;

/** What the tab prints: nothing with nothing waiting, the count, or "9+" past it. */
function tabCount(count: number): string {
  if (count === 0) return '';
  return count > TAB_MAX ? `${TAB_MAX}+` : String(count);
}

/** The tab's fill: the worst severity's, or the quiet surface when nothing waits. */
function tabFill(theme: Theme, worst: AttentionSeverity | null): string {
  return worst === null ? theme.palette.action.selected : severityFill(theme, worst);
}

function tabInk(theme: Theme, worst: AttentionSeverity | null): string {
  return worst === null ? theme.palette.text.secondary : severityInk(theme, worst);
}

export interface AttentionTabProps {
  readonly count: number;
  readonly worst: AttentionSeverity | null;
  /** How the thing the open button would show pulses; `still` when nothing waits. */
  readonly pulse: AttentionPulse;
  readonly label: string;
  readonly zIndex: number;
  /**
   * Where it rests: a side and a height as a share of the screen — halfway
   * down the right edge by default — and, away from an edge, how far across.
   */
  readonly spot?: AttentionDockPosition;
  /** The host's resting inset over its bottom bar (a CSS length): a spot never sits on that bar. */
  readonly bottom?: string;
  /** Where a drag let it go. Without it the tab stays put. */
  readonly onMove?: (spot: AttentionDockPosition) => void;
  readonly onExpand: () => void;
}

/** The half disc's corners: round on the side facing the page. */
function halfDisc(side: 'left' | 'right'): string {
  return side === 'right' ? `${TAB_WIDTH_PX}px 0 0 ${TAB_WIDTH_PX}px` : `0 ${TAB_WIDTH_PX}px ${TAB_WIDTH_PX}px 0`;
}

/**
 * Mid-drag it is a bubble centred where the pressed shape's centre is — the
 * centre {@link tabSpotFor} measures — and kept on the screen.
 */
function liveBubble(
  live: { readonly left: number; readonly top: number },
  spot: AttentionDockPosition,
): { readonly left: number; readonly top: number } {
  const [width, height] = spot.x === undefined ? [TAB_WIDTH_PX, TAB_HEIGHT_PX] : [BUBBLE_PX, BUBBLE_PX];
  const fit = (value: number, room: number): number => Math.min(Math.max(0, value), Math.max(0, room - BUBBLE_PX));
  return {
    left: fit(live.left + (width - BUBBLE_PX) / 2, window.innerWidth),
    top: fit(live.top + (height - BUBBLE_PX) / 2, window.innerHeight),
  };
}

/**
 * Its spot, `y` of the way down (and `x` across, away from an edge) — in the
 * DYNAMIC viewport, which a drag measured (`innerHeight`), with `100vh` for
 * engines without `dvh` — and never lower than the host's inset, so it cannot
 * sit on a bottom bar.
 */
function tabPlacement(
  live: { readonly left: number; readonly top: number } | null,
  spot: AttentionDockPosition,
  bottom: string,
): Record<string, number | string | Record<string, string>> {
  if (live !== null) return liveBubble(live, spot);
  const size = spot.x === undefined ? TAB_HEIGHT_PX : BUBBLE_PX;
  const top = (vh: string): string =>
    `max(0px, min(calc((${vh} - ${size}px) * ${spot.y}), calc(${vh} - ${bottom} - ${size}px)))`;
  const across: Record<string, number | string> =
    spot.x === undefined ? { [spot.side]: 0 } : { left: `calc((100vw - ${BUBBLE_PX}px) * ${spot.x})` };
  return { ...across, top: top('100vh'), '@supports (height: 100dvh)': { top: top('100dvh') } };
}

/** What its side, a drag and floating change: its size, corners, the padding off its edge, its shadow. */
function tabLook(side: 'left' | 'right', round: boolean, dragging: boolean, quiet: boolean): Record<string, unknown> {
  if (round) {
    return {
      width: BUBBLE_PX,
      height: BUBBLE_PX,
      borderRadius: '50%',
      boxShadow: (theme: Theme) =>
        dragging ? `0 12px 18px ${alpha(theme.palette.text.primary, 0.3)}` : `0 2px 8px ${alpha(theme.palette.text.primary, 0.25)}`,
      cursor: dragging ? 'grabbing' : 'pointer',
    };
  }
  const right = side === 'right';
  return {
    width: TAB_WIDTH_PX,
    height: TAB_HEIGHT_PX,
    borderRadius: halfDisc(side),
    // The count sits a little off the edge it is flush with.
    [right ? 'pl' : 'pr']: '3px',
    // A bare tab's edge stops at the screen's edge it is flush with.
    ...(quiet ? { [right ? 'borderRight' : 'borderLeft']: 0 } : {}),
    boxShadow: (theme: Theme) => `${right ? -2 : 2}px 0 6px ${alpha(theme.palette.text.primary, 0.22)}`,
    cursor: 'pointer',
  };
}

/** Its fill, ink and type: the worst severity's, or the quiet surface when nothing waits. */
function tabPaint(worst: AttentionSeverity | null, count: number): Record<string, unknown> {
  return {
    // The quiet fill is a see-through token, so it is laid over the page's
    // own paper: the same colour on that paper, and nothing under it shows.
    bgcolor: 'background.default',
    backgroundImage: (theme: Theme) => `linear-gradient(${tabFill(theme, worst)}, ${tabFill(theme, worst)})`,
    // A bare tab is the quiet surface on the page's own paper: its edge is
    // what finds it, so it keeps one even with nothing waiting.
    border: (theme: Theme) => (worst === null ? `1px solid ${theme.palette.text.secondary}` : 0),
    color: (theme: Theme) => tabInk(theme, worst),
    font: 'inherit',
    fontSize: count > TAB_MAX ? 10 : 13,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '-0.04em',
    whiteSpace: 'nowrap',
  };
}

/** The halos it pulses with: from the edge into the page, or from a bubble's centre as the disc's do. */
function TabHalos({
  pulse,
  worst,
  corners,
  origin,
}: {
  readonly pulse: AttentionPulse;
  readonly worst: AttentionSeverity;
  readonly corners: string;
  /** Where they grow from: the edge it is flush with, or its centre as a bubble. */
  readonly origin: string;
}): JSX.Element {
  return (
    <>
      {halos(pulse).map((halo, index) => (
        <Box
          key={index}
          component="span"
          aria-hidden
          sx={{
            ...HALO_SX,
            borderRadius: corners,
            transformOrigin: origin,
            bgcolor: (theme: Theme) => severityFill(theme, worst),
            animation: halo.animation,
          }}
        />
      ))}
    </>
  );
}

/**
 * The folded button: flush with an edge, halfway down the right one until the
 * reader drags it — anywhere. A press that travels is a drag and opens nothing.
 */
export function AttentionTab({
  count,
  worst,
  pulse,
  label,
  zIndex,
  spot = TAB_REST,
  bottom = '16px',
  onMove,
  onExpand,
}: AttentionTabProps): JSX.Element {
  const { live, handlers } = useDockDrag(
    (edge, drop) => (onMove ?? STAY)(tabSpotFor(edge, drop)),
    TAB_FIT,
  );
  // Mid-drag, or let go away from an edge, it is a whole bubble, not half of one.
  const round = live !== null || spot.x !== undefined;
  const look = tabLook(spot.side, round, live !== null, worst === null);
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      aria-expanded={false}
      data-testid="attention-tab"
      data-severity={worst ?? 'none'}
      data-count={count}
      data-pulse={pulse}
      data-side={spot.side}
      // Away from every edge: it takes no strip of either side.
      data-free={spot.x === undefined ? undefined : ''}
      // It floats over the page by design, flush with an edge: an
      // overlay that takes no room (ADR "an overlay takes no room"), which a
      // screen's checks read through this attribute — so it is drawn OPAQUE.
      data-ui-overlay=""
      {...(onMove === undefined ? {} : handlers)}
      onClick={onExpand}
      sx={{
        position: 'fixed',
        ...tabPlacement(live, spot, bottom),
        zIndex,
        p: 0,
        ...tabPaint(worst, count),
        ...(onMove === undefined ? {} : { touchAction: 'none', userSelect: 'none' }),
        ...look,
        '&:focus-visible': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      {worst !== null && (
        <TabHalos
          pulse={pulse}
          worst={worst}
          corners={look.borderRadius as string}
          origin={round ? 'center' : `${spot.side} center`}
        />
      )}
      <Box component="span" sx={{ position: 'relative' }}>
        {tabCount(count)}
      </Box>
    </Box>
  );
}
