import type { AddressDetails } from './AddressAutocomplete.types';

// The shape shared by google.maps.GeocoderAddressComponent and the canned mock
// components: enough to read a part out by type.
interface AddressComponentLike {
  long_name: string;
  types: string[];
}

interface LatLngLike {
  lat: () => number;
  lng: () => number;
}

// Google reports address parts as an unordered list tagged by type, so every part
// has to be looked up rather than indexed.
const componentReader =
  (components: readonly AddressComponentLike[]) =>
  (type: string): string =>
    components.find((component) => component.types.includes(type))?.long_name || '';

// Places and Geocoder results both make the whole geometry chain optional.
export const coordinatesOf = (geometry?: { location?: LatLngLike }): AddressDetails['coordinates'] => ({
  lat: geometry?.location?.lat() || 0,
  lng: geometry?.location?.lng() || 0,
});

// The four ways an address can arrive — a mock or live prediction, a mock or live
// reverse geocode — all land here, so they agree on how a place becomes an
// AddressDetails.
export const toAddressDetails = ({
  components,
  formatted,
  coordinates,
}: {
  components: readonly AddressComponentLike[];
  formatted: string;
  coordinates: AddressDetails['coordinates'];
}): AddressDetails => {
  const read = componentReader(components);
  const street = `${read('street_number')} ${read('route')}`.trim();

  return {
    formatted,
    // A street number on its own is not an address; fall back to the route name.
    street: street || read('route'),
    city: read('locality') || read('administrative_area_level_2'),
    state: read('administrative_area_level_1'),
    country: read('country'),
    postalCode: read('postal_code'),
    coordinates,
  };
};

// freeSolo mode hands back whatever was typed, with no components to read.
export const freeSoloAddress = (value: string): AddressDetails =>
  toAddressDetails({ components: [], formatted: value, coordinates: { lat: 0, lng: 0 } });
