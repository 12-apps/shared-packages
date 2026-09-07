import type { MapPreviewCopy } from '../../../copy';

import type { FleetMapBaseProps, FleetMapCopyBase } from './FleetMap.base';

/**
 * The WEB half of `FleetMap`'s contract.
 *
 * Everything platform-neutral lives in `FleetMap.base.ts` and is re-exported
 * here unchanged, so a consumer's `import type { FleetUnit } from
 * '@12-apps/ui/data-display/FleetMap'` keeps resolving exactly as it did. What
 * this file adds is what only the web has: the map.
 */
export type {
  FleetFreshness,
  FleetMapBaseProps,
  FleetMapCopyBase,
  FleetUnit,
} from './FleetMap.base';

/**
 * Every word the board prints, plus the map control bar's own six.
 *
 * `map` is web-only because the map half is: `MapPreview` has no React Native
 * build yet, so the native copy interface stops at the roster's words rather
 * than asking a caller to name controls nothing renders. See `NATIVE-NOTES.md`.
 */
export interface FleetMapCopy extends FleetMapCopyBase {
  /**
   * The map region's accessible name.
   *
   * The map is NOT `aria-hidden`, and that is deliberate rather than an
   * oversight: it carries focusable controls (zoom, centre, map type), and
   * `aria-hidden` over a focusable subtree is the `aria-hidden-focus`
   * violation — a keyboard user tabs into a region a screen reader insists is
   * not there. So it is a NAMED region a reader can skip past instead, and the
   * roster beside it carries every fact a pin does.
   *
   * Skipping it does not silence it: `MapPreview` carries its own
   * `aria-live="polite"` and announces its centre in English on every
   * re-centre. See `FleetCanvas` for why that is stated rather than fixed here.
   */
  mapLabel: string;
  /** The map control bar's own six names. */
  map: MapPreviewCopy;
}

/** Props for the {@link FleetMap} live board. */
export interface FleetMapProps extends FleetMapBaseProps {
  copy: FleetMapCopy;
  /** Map height, any CSS length. */
  height?: string;
  className?: string;
}
