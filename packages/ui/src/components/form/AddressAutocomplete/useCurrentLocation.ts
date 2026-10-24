import type { AddressAutocompleteCopy } from '../../../copy/form';
import { useCallback } from 'react';

import { coordinatesOf, toAddressDetails } from './AddressAutocomplete.mapper';
import type { AddressDetails } from './AddressAutocomplete.types';
import { MOCK_ADDRESSES, MOCK_PLACE_DETAILS } from './mockPlaces';
import type { GoogleMapsService } from './useGoogleMapsAPI';

const MOCK_GEOLOCATION_DELAY_MS = 500;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 600_000, // 10 minutes
};

interface LocationSink {
  messages: Required<AddressAutocompleteCopy>;
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
  applyAddress: (address: AddressDetails) => void;
}

// Mock mode answers with the first canned address after a pause, so the button
// behaves like a real geolocation round trip.
const resolveMockLocation = (sink: LocationSink) => {
  window.setTimeout(() => {
    sink.setLoading(false);

    const mockLocation = MOCK_ADDRESSES[0];
    if (!mockLocation) {
      sink.setApiError(sink.messages.noMockLocation);
      return;
    }

    const mockDetails = MOCK_PLACE_DETAILS[mockLocation.place_id];
    if (!mockDetails) {
      sink.setApiError(sink.messages.mockLocationNotFound);
      return;
    }

    sink.applyAddress(
      toAddressDetails({
        components: mockDetails.address_components,
        formatted: mockDetails.formatted_address,
        coordinates: coordinatesOf(mockDetails.geometry),
      }),
    );
  }, MOCK_GEOLOCATION_DELAY_MS);
};

const geocodePosition =
  (geocoder: google.maps.Geocoder, sink: LocationSink) => (position: GeolocationPosition) => {
    const { latitude, longitude } = position.coords;
    const location = new google.maps.LatLng(latitude, longitude);

    geocoder.geocode({ location }, (results, status) => {
      sink.setLoading(false);

      const place = status === 'OK' ? results?.[0] : undefined;
      if (!place) {
        sink.setApiError(sink.messages.locationAddressFailed);
        return;
      }

      sink.applyAddress(
        toAddressDetails({
          components: place.address_components,
          formatted: place.formatted_address,
          // The device's own fix is more precise than the geocoded place's.
          coordinates: { lat: latitude, lng: longitude },
        }),
      );
    });
  };

export const useCurrentLocation = ({
  services,
  useMockData,
  setLoading,
  setApiError,
  applyAddress,
  messages,
}: {
  messages: Required<AddressAutocompleteCopy>;
  services: GoogleMapsService;
  useMockData: boolean;
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
  applyAddress: (address: AddressDetails) => void;
}) =>
  useCallback(() => {
    if (!navigator.geolocation) {
      setApiError(messages.geolocationUnsupported);
      return;
    }

    const sink: LocationSink = { setLoading, setApiError, applyAddress, messages };

    if (useMockData) {
      setLoading(true);
      resolveMockLocation(sink);
      return;
    }

    if (!services.geocoder) {
      setApiError(messages.geocoderUnavailable);
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      geocodePosition(services.geocoder, sink),
      () => {
        setLoading(false);
        setApiError(messages.locationFailed);
      },
      GEOLOCATION_OPTIONS,
    );
  }, [services, useMockData, setLoading, setApiError, applyAddress, messages]);
