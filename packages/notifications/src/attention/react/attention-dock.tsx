/**
 * Where the button sits — and the reader can move it.
 *
 * Fixed to the screen's foot, on the right, until the reader DRAGS it: then it
 * snaps to the nearer side, as a phone's floating bubbles do, at the height it
 * was let go, and the device remembers the spot (`./preferences.ts`).
 *
 * A press that travels under six pixels is a tap and reaches the button
 * untouched; anything further is a drag, and the click that follows it is
 * swallowed, so moving the button never opens what it points at.
 *
 * `bottom` is a CSS length the host owns — usually its own inset over a bottom
 * bar — so the resting spot clears whatever the host docks at the foot.
 *
 * `rest` is where it sits before the reader ever moves it: the right corner,
 * or the CENTRE of the foot — for a host whose own last control lives in that
 * corner. A drag still snaps it to the nearer side; centre is only the start.
 */
import type { JSX, ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import { EDGE_GAP_PX, RESTING_SPAN_PX, useDockDrag } from './use-dock-drag';
import type { AttentionDockPosition } from './preferences';

/** Where an unmoved dock rests: the foot's right corner, or its centre. */
export type AttentionDockRest = 'right' | 'center';

export interface AttentionDockProps {
  readonly position: AttentionDockPosition | null;
  readonly onMove: (position: AttentionDockPosition) => void;
  /** The resting spot's distance from the screen's foot (a CSS length). */
  readonly bottom?: string;
  readonly zIndex?: number;
  /** Where it rests until the reader moves it — the right corner by default. */
  readonly rest?: AttentionDockRest;
  /** Laid out from the inner edge outwards: give them in reading order, the button last. */
  readonly children: ReactNode;
}

/**
 * Its distance from the side it rests on: 12px on a phone, 24px from `sm` up —
 * the approved boards' own pads, the screen's edge being closer on a phone.
 */
const SIDE_GAP = { xs: '12px', sm: '24px' } as const;

/** The foot's centre: half the screen in, less half its own width. */
const CENTRE = { left: '50%', transform: 'translateX(-50%)' } as const;

function placement(
  live: { readonly left: number; readonly top: number } | null,
  position: AttentionDockPosition | null,
  bottom: string,
  rest: AttentionDockRest,
): Record<string, number | string | Record<string, string>> {
  if (live !== null) return { left: live.left, top: live.top };
  if (position === null) return rest === 'center' ? { ...CENTRE, bottom } : { right: SIDE_GAP, bottom };
  const restore = (vh: string): string =>
    `min(calc((${vh} - ${RESTING_SPAN_PX}px) * ${position.y} + ${EDGE_GAP_PX / 2}px), calc(${vh} - ${bottom} - ${RESTING_SPAN_PX - EDGE_GAP_PX}px))`;
  return {
    [position.side]: SIDE_GAP,
    // Stored against `innerHeight`, which is the DYNAMIC viewport — `100vh` is
    // the large one on a phone and would land it behind the browser's own bar.
    // `100vh` stays as the fallback for engines without `dvh` (older WebViews),
    // where the `dvh` declaration would otherwise drop the whole `top`. Never
    // below the host's resting inset either, so a stored spot cannot sit on
    // the host's bottom bar.
    top: restore('100vh'),
    '@supports (height: 100dvh)': { top: restore('100dvh') },
  };
}

/** The side it names in `data-side`: `center` while it rests at the foot's centre, so a host can tell. */
function namedSide(position: AttentionDockPosition | null, rest: AttentionDockRest): string {
  if (position === null && rest === 'center') return 'center';
  return position?.side ?? 'right';
}

/** The hand's look: a grabbing cursor and a lifted shadow while it is dragged. */
function dragLook(dragging: boolean): { cursor: string; filter: string } {
  return dragging
    ? { cursor: 'grabbing', filter: 'drop-shadow(0 12px 18px rgba(0,0,0,0.3))' }
    : { cursor: 'grab', filter: 'none' };
}

export function AttentionDock({
  position,
  onMove,
  bottom = '16px',
  zIndex = 1200,
  rest = 'right',
  children,
}: AttentionDockProps): JSX.Element {
  const { live, handlers } = useDockDrag(onMove);
  const side = position?.side ?? 'right';
  return (
    <Box
      data-testid="attention-dock"
      data-side={namedSide(position, rest)}
      {...handlers}
      sx={{
        position: 'fixed',
        ...placement(live, position, bottom, rest),
        zIndex,
        display: 'flex',
        // The small things sit on the INNER side, so nothing hangs off the screen.
        flexDirection: side === 'left' ? 'row-reverse' : 'row',
        alignItems: 'center',
        gap: '12px',
        touchAction: 'none',
        userSelect: 'none',
        ...dragLook(live !== null),
      }}
    >
      {children}
    </Box>
  );
}
