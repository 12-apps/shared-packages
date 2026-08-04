import type React from 'react';
import { useCallback } from 'react';

import { coordinatesOf, freeSoloAddress, toAddressDetails } from './AddressAutocomplete.mapper';
import type {
  AddressDetails,
  AddressOptionValue,
  AddressPrediction,
} from './AddressAutocomplete.types';
import { MOCK_PLACE_DETAILS } from './mockPlaces';
import type { GoogleMapsService } from './useGoogleMapsAPI';

const MOCK_DETAILS_DELAY_MS = 50;

const PLACE_DETAIL_FIELDS = ['formatted_address', 'address_components', 'geometry'];

interface SelectionSink {
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
  applyAddress: (address: AddressDetails) => void;
}

const resolveMockPlace = (value: AddressPrediction, sink: SelectionSink) => {
  window.setTimeout(() => {
    sink.setLoading(false);

    const place = MOCK_PLACE_DETAILS[value.place_id];
    if (!place) {
      sink.setApiError('Address details not found');
      return;
    }

    sink.applyAddress(
      toAddressDetails({
        components: place.address_components,
        formatted: place.formatted_address || value.description,
        coordinates: coordinatesOf(place.geometry),
      }),
    );
  }, MOCK_DETAILS_DELAY_MS);
};

const resolveLivePlace = (
  service: google.maps.places.PlacesService,
  value: AddressPrediction,
  sink: SelectionSink,
) => {
  const request: google.maps.places.PlaceDetailsRequest = {
    placeId: value.place_id,
    fields: PLACE_DETAIL_FIELDS,
  };

  service.getDetails(request, (place, status) => {
    sink.setLoading(false);

    if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
      sink.setApiError('Failed to get address details');
      return;
    }

    sink.applyAddress(
      toAddressDetails({
        components: place.address_components ?? [],
        formatted: place.formatted_address || value.description,
        coordinates: coordinatesOf(place.geometry),
      }),
    );
  });
};

export const useAddressSelection = ({
  services,
  useMockData,
  setLoading,
  setApiError,
  onSelect,
  applyAddress,
}: {
  services: GoogleMapsService;
  useMockData: boolean;
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
  onSelect: (address: AddressDetails) => void;
  applyAddress: (address: AddressDetails) => void;
}) =>
  useCallback(
    (_event: React.SyntheticEvent, value: AddressOptionValue | null) => {
      // freeSolo text is reported as typed; there is no place to look up, and the
      // input already holds it.
      if (typeof value === 'string') {
        onSelect(freeSoloAddress(value));
        return;
      }

      if (!value) return;

      setLoading(true);
      const sink: SelectionSink = { setLoading, setApiError, applyAddress };

      if (useMockData && 'place_id' in value) {
        resolveMockPlace(value, sink);
        return;
      }

      if (!services.placesService) {
        setLoading(false);
        return;
      }

      resolveLivePlace(services.placesService, value, sink);
    },
    [services, useMockData, setLoading, setApiError, onSelect, applyAddress],
  );
