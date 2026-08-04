import type { ReactNode } from 'react';

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
