import type { Theme } from '@mui/material/styles/index.js';
import { alpha } from '@mui/material/styles/index.js';

import { DEFAULT_ZOOM } from './MapPreview.constants';
import type { MapPreviewProps } from './MapPreview.types';
import type { MapPreviewCopy } from '../../../copy/data-display';
import { EN_US_MAP_PREVIEW_COPY } from '../../../en-US.data-display';
import { rem } from '../../../tokens/relative';

type MapDefaultedKeys =
  | 'markers'
  | 'marker'
  | 'interactive'
  | 'zoom'
  | 'mapType'
  | 'variant'
  | 'showControls'
  | 'showSearch'
  | 'showRoute'
  | 'heatmapData'
  | 'showHeatmap'
  | 'animated';

export type ResolvedMapPreviewProps = MapPreviewProps &
  Required<Pick<MapPreviewProps, MapDefaultedKeys>>;

const MAP_PREVIEW_DEFAULTS: Pick<MapPreviewProps, MapDefaultedKeys> = {
  markers: [],
  marker: true,
  interactive: false,
  zoom: DEFAULT_ZOOM,
  mapType: 'roadmap',
  variant: 'default',
  showControls: true,
  showSearch: false,
  showRoute: false,
  heatmapData: [],
  showHeatmap: false,
  animated: true,
};

/**
 * The copy the map renders: the host's pack over the English one, key by key,
 * so a pack written before the optional keys existed still renders every word.
 */
export const resolveMapCopy = (copy: MapPreviewCopy): Required<MapPreviewCopy> => ({
  ...EN_US_MAP_PREVIEW_COPY,
  ...(Object.fromEntries(
    Object.entries(copy).filter(([, value]) => value !== undefined),
  ) as MapPreviewCopy),
});

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: MapPreviewProps): Partial<MapPreviewProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<MapPreviewProps>;

// Applied as a merge rather than destructuring defaults, which would otherwise
// put fourteen branches into the component's own complexity budget.
export const resolveMapPreviewProps = (props: MapPreviewProps): ResolvedMapPreviewProps =>
  ({ ...MAP_PREVIEW_DEFAULTS, ...definedProps(props) }) as ResolvedMapPreviewProps;

export const glassStyles = (variant: MapPreviewProps['variant'], theme: Theme) =>
  variant === 'glass'
    ? {
        background: alpha(theme.palette.background.paper, 0.7),
        backdropFilter: `blur(${rem(theme, 20)})`,
        WebkitBackdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      }
    : {};
