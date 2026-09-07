import type { StyleProp, ViewStyle } from 'react-native';

import type { FleetMapBaseProps, FleetMapCopyBase } from './FleetMap.base';

/**
 * The REACT NATIVE half of `FleetMap`'s contract.
 *
 * Everything platform-neutral is re-exported from `FleetMap.base.ts` unchanged.
 * What differs is at both ends of the file: there is no `map` copy and no
 * `mapLabel`, because there is no map — `MapPreview` has no native build, and
 * the roster is this component's own stated "accessible representation, not a
 * sidebar", which is exactly the half that ports. And `style` stands where the
 * web takes `className`, which is the ordinary `sx`/`style` split.
 */
export type {
  FleetFreshness,
  FleetMapBaseProps,
  FleetMapCopyBase,
  FleetUnit,
} from './FleetMap.base';

/**
 * Every word the native board prints.
 *
 * An alias rather than an empty `extends`, so that the day `MapPreview` is
 * ported this becomes an interface with the map's words in it and no consumer
 * import has to move.
 */
export type FleetMapCopy = FleetMapCopyBase;

/** Props for the native {@link FleetMap} board. */
export interface FleetMapProps extends FleetMapBaseProps {
  copy: FleetMapCopy;
  /**
   * A ceiling for the roster, so a fleet of thirty scrolls inside the panel
   * rather than pushing everything below it off the screen.
   *
   * A NUMBER of pixels, where the web takes any CSS length: React Native has no
   * `calc`, no viewport units and no `%` that resolves against a parent which
   * has not sized itself.
   */
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}
