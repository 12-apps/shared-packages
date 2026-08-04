import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MIN_QUERY_LENGTH } from './AddressAutocomplete.helpers';
import type { AddressAutocompleteProps, AddressOptionValue } from './AddressAutocomplete.types';
import { searchMockAddresses } from './mockPlaces';
import type { GoogleMapsService } from './useGoogleMapsAPI';

const DEBOUNCE_MS = 300;
// Long enough to exercise the loading state, short enough not to slow tests down.
const MOCK_PREDICTION_DELAY_MS = 100;

type Restrictions = AddressAutocompleteProps['restrictions'];

interface PredictionSink {
  setOptions: (options: AddressOptionValue[]) => void;
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
}

const predictionRequest = (
  input: string,
  restrictions: Restrictions,
): google.maps.places.AutocompletionRequest => ({
  input: input.trim(),
  componentRestrictions: restrictions?.country ? { country: restrictions.country } : undefined,
  types: restrictions?.types || [],
});

const fetchMockPredictions = (input: string, sink: PredictionSink) => {
  window.setTimeout(() => {
    sink.setLoading(false);
    sink.setOptions(searchMockAddresses(input));
    sink.setApiError(null);
  }, MOCK_PREDICTION_DELAY_MS);
};

const fetchLivePredictions = (
  service: google.maps.places.AutocompleteService,
  input: string,
  restrictions: Restrictions,
  sink: PredictionSink,
) => {
  service.getPlacePredictions(predictionRequest(input, restrictions), (predictions, status) => {
    sink.setLoading(false);

    if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
      sink.setOptions(predictions);
      sink.setApiError(null);
      return;
    }

    // No matches is a normal outcome, not something to complain about.
    sink.setOptions([]);
    sink.setApiError(
      status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS
        ? null
        : 'Failed to fetch address suggestions',
    );
  });
};

export const useAddressPredictions = ({
  isLoaded,
  services,
  restrictions,
  useMockData,
  setInputValue,
  setLoading,
  setApiError,
}: {
  isLoaded: boolean;
  services: GoogleMapsService;
  restrictions: Restrictions;
  useMockData: boolean;
  setInputValue: (value: string) => void;
  setLoading: (loading: boolean) => void;
  setApiError: (message: string | null) => void;
}) => {
  const [options, setOptions] = useState<AddressOptionValue[]>([]);
  const debounceTimeoutRef = useRef<number | undefined>(undefined);

  const sink = useMemo<PredictionSink>(
    () => ({ setOptions, setLoading, setApiError }),
    [setLoading, setApiError],
  );

  const debouncedAutocomplete = useCallback(
    (input: string) => {
      window.clearTimeout(debounceTimeoutRef.current);

      debounceTimeoutRef.current = window.setTimeout(() => {
        if (!input.trim() || !isLoaded) {
          setOptions([]);
          setLoading(false);
          return;
        }

        if (useMockData) {
          fetchMockPredictions(input, sink);
          return;
        }

        if (!services.autocompleteService) {
          setOptions([]);
          setLoading(false);
          return;
        }

        fetchLivePredictions(services.autocompleteService, input, restrictions, sink);
      }, DEBOUNCE_MS);
    },
    [isLoaded, services, restrictions, useMockData, sink, setLoading],
  );

  useEffect(() => () => window.clearTimeout(debounceTimeoutRef.current), []);

  const handleInputChange = useCallback(
    (_event: React.SyntheticEvent, value: string) => {
      setInputValue(value);
      setApiError(null);

      if (value.length > MIN_QUERY_LENGTH) {
        setLoading(true);
        debouncedAutocomplete(value);
        return;
      }

      setOptions([]);
      setLoading(false);
    },
    [debouncedAutocomplete, setInputValue, setApiError, setLoading],
  );

  return { options, handleInputChange };
};
