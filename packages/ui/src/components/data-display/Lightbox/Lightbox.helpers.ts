import type { LightboxProps } from './Lightbox.types';

type LightboxDefaultedKeys =
  | 'isOpen'
  | 'items'
  | 'startIndex'
  | 'showControls'
  | 'showCaptions'
  | 'loop'
  | 'autoplay'
  | 'thumbnails'
  | 'zoomable';

export type ResolvedLightboxProps = LightboxProps &
  Required<Pick<LightboxProps, LightboxDefaultedKeys>>;

const LIGHTBOX_DEFAULTS: Pick<LightboxProps, LightboxDefaultedKeys> = {
  isOpen: false,
  items: [],
  startIndex: 0,
  showControls: true,
  showCaptions: true,
  loop: false,
  autoplay: false,
  thumbnails: false,
  zoomable: true,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: LightboxProps): Partial<LightboxProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<LightboxProps>;

// Applied as a merge rather than destructuring defaults, which would otherwise
// put nine branches into the component's own complexity budget.
export const resolveLightboxProps = (props: LightboxProps): ResolvedLightboxProps =>
  ({ ...LIGHTBOX_DEFAULTS, ...definedProps(props) }) as ResolvedLightboxProps;
