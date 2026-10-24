import type { AddressAutocompleteCopy } from '../../../copy/form';
import { EN_US_ADDRESS_AUTOCOMPLETE_COPY } from '../../../en-US.form';
import { resolveLabels } from '../../../utils/resolve-labels';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import type {
  AddressAutocompleteProps,
  AddressDetails,
  AddressOptionValue,
} from './AddressAutocomplete.types';
import { useAddressPredictions } from './useAddressPredictions';
import { useAddressSelection } from './useAddressSelection';
import { useCurrentLocation } from './useCurrentLocation';
import { useGoogleMapsAPI } from './useGoogleMapsAPI';

export interface AddressAutocompleteState {
  inputValue: string;
  options: AddressOptionValue[];
  loading: boolean;
  apiError: string | null;
  mapsError: string | null;
  isLoaded: boolean;
  handleInputChange: (event: React.SyntheticEvent, value: string) => void;
  handleSelect: (event: React.SyntheticEvent, value: AddressOptionValue | null) => void;
  handleGetCurrentLocation: () => void;
}

// Owns the state the three Places concerns share — the field's text, whether a
// request is in flight, and the last error — then hands each concern the slice it
// writes to.
export const useAddressAutocomplete = ({
  defaultValue,
  googleMapsApiKey,
  restrictions,
  onSelect,
  copy,
}: {
  copy: AddressAutocompleteCopy;
  defaultValue: string;
  googleMapsApiKey: string;
  restrictions: AddressAutocompleteProps['restrictions'];
  onSelect: (address: AddressDetails) => void;
}): AddressAutocompleteState => {
  const [inputValue, setInputValue] = useState(defaultValue);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  // Memoised so the selection and location callbacks keep their identity.
  const messages = useMemo(() => resolveLabels(EN_US_ADDRESS_AUTOCOMPLETE_COPY, copy), [copy]);

  const { isLoaded, error: mapsError, services, useMockData } = useGoogleMapsAPI(googleMapsApiKey, {
    loadFailed: messages.mapsApiLoadFailed,
    initFailed: messages.mapsServicesInitFailed,
  });

  // A resolved address both notifies the caller and becomes the field's text.
  const applyAddress = useCallback(
    (address: AddressDetails) => {
      onSelect(address);
      setInputValue(address.formatted);
    },
    [onSelect],
  );

  const { options, handleInputChange } = useAddressPredictions({
    isLoaded,
    services,
    restrictions,
    useMockData,
    setInputValue,
    setLoading,
    setApiError,
    fetchFailed: messages.fetchSuggestionsFailed,
  });

  const handleSelect = useAddressSelection({
    services,
    useMockData,
    setLoading,
    setApiError,
    onSelect,
    applyAddress,
    messages,
  });

  const handleGetCurrentLocation = useCurrentLocation({
    services,
    useMockData,
    setLoading,
    setApiError,
    applyAddress,
    messages,
  });

  return {
    inputValue,
    options,
    loading,
    apiError,
    mapsError,
    isLoaded,
    handleInputChange,
    handleSelect,
    handleGetCurrentLocation,
  };
};
