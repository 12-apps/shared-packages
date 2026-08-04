import type { Theme } from '@mui/material';
import { alpha } from '@mui/material';

import { DEFAULT_ZOOM } from './MapPreview.constants';
import type { MapPreviewProps } from './MapPreview.types';

type MapDefaultedKeys =
  | 'markers'
  | 'marker'
  | 'height'
  | 'interactive'
  | 'zoom'
  | 'mapType'
  | 'variant'
  | 'showControls'
  | 'showSearch'
  | 'searchPlaceholder'
  | 'showRoute'
  | 'heatmapData'
  | 'showHeatmap'
  | 'animated';

export type ResolvedMapPreviewProps = MapPreviewProps &
  Required<Pick<MapPreviewProps, MapDefaultedKeys>>;

const MAP_PREVIEW_DEFAULTS: Pick<MapPreviewProps, MapDefaultedKeys> = {
  markers: [],
  marker: true,
  height: '400px',
  interactive: false,
  zoom: DEFAULT_ZOOM,
  mapType: 'roadmap',
  variant: 'default',
  showControls: true,
  showSearch: false,
  searchPlaceholder: 'Search location...',
  showRoute: false,
  heatmapData: [],
  showHeatmap: false,
  animated: true,
};

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
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      }
    : {};
