import type { MapPreviewCopy } from '../../../copy';

export type MapType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapMarker {
  position: { lat: number; lng: number };
  title?: string;
  description?: string;
  icon?: string;
  onClick?: () => void;
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

export interface MapPreviewProps {
  /**
   * The control bar's six names and the search field's own. Every control is a
   * glyph carrying a `title` and an `aria-label`, so this is both the tooltip
   * and what a screen reader reads. REQUIRED — `searchPlaceholder` beside it
   * shows the shape this replaces: an English default that read as
   * configurable right up until nobody configured it.
   */
  copy: MapPreviewCopy;
  /** Map center coordinates */
  center?: { lat: number; lng: number };
  /** Legacy coordinates prop (use center instead) */
  coordinates?: { lat: number; lng: number };
  /** Array of markers to display */
  markers?: MapMarker[];
  /** Single marker (use markers array instead) */
  marker?: boolean;
  /** Map height */
  height?: string;
  /** Enable user interaction */
  interactive?: boolean;
  /** Initial zoom level */
  zoom?: number;
  /** Google Maps API key */
  googleMapsApiKey?: string;
  /** Map display type */
  mapType?: MapType;
  /** Map style variant */
  variant?: 'default' | 'glass' | 'satellite' | 'dark';
  /** Show map controls */
  showControls?: boolean;
  /** Show search functionality */
  showSearch?: boolean;
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** Enable route display */
  showRoute?: boolean;
  /** Route line color */
  routeColor?: string;
  /** Heatmap data points */
  heatmapData?: HeatmapPoint[];
  /** Show heatmap overlay */
  showHeatmap?: boolean;
  /** Enable smooth animations */
  animated?: boolean;
  /** Callback when marker is dragged */
  onMarkerDrag?: (coords: { lat: number; lng: number }) => void;
  /** Callback when map is clicked */
  onMapClick?: (lat: number, lng: number) => void;
}
