/**
 * Where the attention dock sits, folded host or not, and what a drag does.
 */
import { useState } from 'react';

import type { AttentionDockRest } from './attention-dock';
import { TAB_REST } from './attention-tab';
import type { AttentionDockPosition, AttentionPreferences, AttentionPreferencesStore } from './preferences';

/** Where the tab sits until the reader drags it, and so where it opens: halfway down the right edge. */
const FOLDED_REST: AttentionDockPosition = TAB_REST;

/**
 * Where the dock sits and what a drag does with it. Unfolded hosts keep the
 * device's remembered spot; a folded host remembers the TAB's spot instead —
 * the button opens there — and keeps a drag of the open button for THIS
 * opening only, so folding back always lands where the tab is.
 */
export function useDockSpot(
  store: AttentionPreferencesStore,
  preferences: AttentionPreferences,
  folding: boolean,
): {
  readonly position: AttentionDockPosition | null;
  readonly onMove: (dock: AttentionDockPosition) => void;
  readonly reset: () => void;
  /** The side it rests on, for the list that hangs off it. */
  readonly side: 'left' | 'right';
  /** Where it rests until moved: the folded mode's spot, or the dock's own default. */
  readonly rest: AttentionDockRest | undefined;
  /** In the screen's top half: what hangs off it goes below, never off the top. */
  readonly high: boolean;
  /** Where the folded tab rests, and what a drag of it does. */
  readonly tab: AttentionDockPosition;
  readonly onMoveTab: (dock: AttentionDockPosition) => void;
} {
  const [spot, setSpot] = useState<AttentionDockPosition | null>(null);
  if (!folding) {
    return {
      position: preferences.dock,
      onMove: (dock) => store.write({ dock }),
      reset: () => undefined,
      side: preferences.dock?.side ?? 'right',
      rest: undefined,
      high: preferences.dock !== null && preferences.dock.y < 0.5,
      tab: FOLDED_REST,
      onMoveTab: () => undefined,
    };
  }
  const tab = preferences.dock ?? FOLDED_REST;
  return {
    position: spot,
    onMove: setSpot,
    reset: () => setSpot(null),
    side: (spot ?? tab).side,
    rest: tab,
    // Halfway down, the list opens below; the "−" goes with it.
    high: (spot ?? tab).y <= 0.5,
    tab,
    onMoveTab: (dock) => store.write({ dock }),
  };
}
