import type { CountryCode } from 'libphonenumber-js';
import { AsYouType, parsePhoneNumber } from 'libphonenumber-js';

import { countries } from './countries';

export const formatPhoneNumber = (value: string, country: CountryCode): string => {
  if (!value || value.trim() === '') return value;

  try {
    const phoneNumber = parsePhoneNumber(value, country);
    // Format if we have a phone number object, regardless of strict validity
    // This allows formatting of test numbers (like 555 prefix) and partially valid numbers
    if (phoneNumber) {
      return phoneNumber.formatInternational();
    }
  } catch {
    // Silently handle formatting errors
  }
  return value;
};

export const validatePhoneNumber = (value: string, country: CountryCode): boolean => {
  if (!value || value.trim() === '') return false;

  try {
    const phoneNumber = parsePhoneNumber(value, country);
    // Consider a number valid if it can be parsed and has the right format
    // This allows test numbers (like 555 prefix) which isPossible but not isValid
    return phoneNumber ? phoneNumber.isPossible() : false;
  } catch {
    // Silently handle validation errors
    return false;
  }
};

// Enhanced helper to detect country from number
export const detectCountryFromNumber = (value: string): CountryCode | undefined => {
  if (!value || !value.startsWith('+')) return undefined;

  try {
    const phoneNumber = parsePhoneNumber(value);
    return phoneNumber?.country;
  } catch {
    return undefined;
  }
};

// Main component
