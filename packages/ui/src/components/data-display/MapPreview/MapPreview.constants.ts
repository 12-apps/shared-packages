import type { MapType } from './MapPreview.types';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 20;
export const DEFAULT_ZOOM = 15;
export const CITY_ZOOM = 12;

// The order the map-type button cycles through.
export const MAP_TYPES: MapType[] = ['roadmap', 'satellite', 'hybrid', 'terrain'];

// Degrees of movement per pixel dragged — small enough that a drag reads as a
// nudge rather than a jump.
export const DRAG_DEGREES_PER_PIXEL = 0.0001;

// Spread of the simulated coordinate change a map click produces.
export const CLICK_JITTER_DEGREES = 0.001;

export const MARKER_PIXELS_PER_DEGREE = 100;
export const HEATMAP_VIEWBOX = { width: 800, height: 400 };
