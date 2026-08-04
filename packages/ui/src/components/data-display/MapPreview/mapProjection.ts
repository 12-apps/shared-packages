export const TILE_SIZE = 256;

// Metres covered by one pixel at zoom 0 on the equator; each zoom level halves it.
const EQUATOR_METRES_PER_PIXEL = 156543.03392;
const SCALE_BAR_PIXELS = 100;
const GEOCODE_DELAY_MS = 300;

// Web Mercator. Longitude maps linearly; latitude goes through the log of the
// tangent, clamped just short of the poles where that diverges.
const project = (lat: number, lng: number) => {
  const siny = Math.sin((lat * Math.PI) / 180);
  const boundedSiny = Math.max(-0.9999, Math.min(0.9999, siny));

  return {
    x: TILE_SIZE * (0.5 + lng / 360),
    y: TILE_SIZE * (0.5 - Math.log((1 + boundedSiny) / (1 - boundedSiny)) / (4 * Math.PI)),
  };
};

export const getTileCoordinates = (lat: number, lng: number, zoom: number) => {
  const scale = 1 << zoom;
  const world = project(lat, lng);

  return {
    x: Math.floor(Math.floor(world.x * scale) / TILE_SIZE),
    y: Math.floor(Math.floor(world.y * scale) / TILE_SIZE),
  };
};

export const getScaleDistance = (zoom: number): string => {
  const distance = (EQUATOR_METRES_PER_PIXEL / Math.pow(2, zoom)) * SCALE_BAR_PIXELS;

  if (distance >= 1000) return `${Math.round(distance / 1000)} km`;
  // Round to the nearest 100m so the bar reads as a round number.
  if (distance >= 100) return `${Math.round(distance / 100) * 100} m`;
  return `${Math.round(distance)} m`;
};

const MOCK_GEOCODE_RESULTS: Record<string, { lat: number; lng: number }> = {
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'new york': { lat: 40.7128, lng: -74.006 },
  london: { lat: 51.5074, lng: -0.1278 },
  tokyo: { lat: 35.6762, lng: 139.6503 },
  paris: { lat: 48.8566, lng: 2.3522 },
};

// Stands in for a Places lookup, delay included so the disabled search field is
// actually observable.
export const geocode = async (address: string): Promise<{ lat: number; lng: number } | null> => {
  await new Promise((resolve) => window.setTimeout(resolve, GEOCODE_DELAY_MS));
  return MOCK_GEOCODE_RESULTS[address.toLowerCase().trim()] || null;
};
