import type { ReactNode } from 'react';

import type { AddressAutocompleteCopy } from '../../../copy';
import type { MockPrediction } from './mockPlaces';

/// <reference types="@types/google.maps" />

// What the Autocomplete holds: a live prediction, a canned one, or — in freeSolo
// mode — the raw text.
export type AddressOptionValue =
  | string
  | google.maps.places.AutocompletePrediction
  | MockPrediction;

export type AddressPrediction = google.maps.places.AutocompletePrediction | MockPrediction;

export interface AddressDetails {
  formatted: string;
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export interface AddressAutocompleteProps {
  /**
   * The field's own three sentences. REQUIRED: this package ships no default
   * copy, and two of the three are read while the field is unusable because
   * Google Maps never arrived — the worst moment to speak the wrong language.
   */
  copy: AddressAutocompleteCopy;
  variant?: 'glass' | 'outlined' | 'filled';
  label?: string;
  placeholder?: string;
  icon?: ReactNode;
  onSelect: (address: AddressDetails) => void;
  googleMapsApiKey: string;
  floating?: boolean;
  restrictions?: {
    country?: string | string[];
    types?: string[];
  };
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  defaultValue?: string;
  getCurrentLocation?: boolean;
}
