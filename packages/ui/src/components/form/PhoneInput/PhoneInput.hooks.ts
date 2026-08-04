import type { CountryCode } from 'libphonenumber-js';
import React, { useEffect, useRef, useState } from 'react';

import { countries } from './countries';
import { detectCountryFromNumber, formatPhoneNumber, validatePhoneNumber } from './phone';
import type { CountryData } from './PhoneInput.types';

// Value, selected country, menu anchor and validity, plus the handlers that move
// between them. Kept out of the component so its body is markup.
export const usePhoneInput = ({
  defaultValue,
  initialCountryCode,
  onChange,
}: {
  defaultValue: string;
  initialCountryCode: CountryCode;
  onChange?: (value: string, isValid: boolean, country: CountryCode) => void;
}) => {
const [value, setValue] = useState(defaultValue);
const [selectedCountry, setSelectedCountry] = useState(
  countries.find((c) => c.code === initialCountryCode) || countries[0],
);
const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
const [isValid, setIsValid] = useState(false);
const [isFocused, setIsFocused] = useState(false);
const onChangeRef = useRef(onChange);
const isInitialMountRef = useRef(true);

// Update ref when onChange changes
useEffect(() => {
  onChangeRef.current = onChange;
}, [onChange]);

useEffect(() => {
  if (!selectedCountry) return;

  const valid = validatePhoneNumber(value, selectedCountry.code);
  setIsValid(valid);

  // Skip onChange call on initial mount
  if (isInitialMountRef.current) {
    isInitialMountRef.current = false;
    return;
  }

  // Call onChange for all value/country changes after initial mount
  if (onChangeRef.current) {
    onChangeRef.current(value, valid, selectedCountry.code);
  }
}, [value, selectedCountry]);

  const handlers = usePhoneHandlers({
    value,
    setValue,
    selectedCountry,
    setSelectedCountry,
    setAnchorEl,
    setIsFocused,
  });

  return {
    value,
    selectedCountry,
    anchorEl,
    isValid,
    isFocused,
    setIsFocused,
    setAnchorEl,
    ...handlers,
  };
};

// Opening and closing the country menu, picking a country, typing, and
// reformatting on blur.
const usePhoneHandlers = ({
  value,
  setValue,
  selectedCountry,
  setSelectedCountry,
  setAnchorEl,
  setIsFocused,
}: {
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  selectedCountry?: CountryData;
  setSelectedCountry: React.Dispatch<React.SetStateAction<CountryData | undefined>>;
  setAnchorEl: React.Dispatch<React.SetStateAction<null | HTMLElement>>;
  setIsFocused: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const handleCountryClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleCountryClose = () => {
    setAnchorEl(null);
  };

  const handleCountrySelect = (country: CountryData) => {
    setSelectedCountry(country);
    handleCountryClose();

    // Reformat number with new country code
    if (value) {
      const formatted = formatPhoneNumber(value, country.code);
      setValue(formatted);
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    setValue(newValue);

    // Auto-detect country if user types international format
    if (newValue.startsWith('+')) {
      const detectedCountry = detectCountryFromNumber(newValue);
      if (detectedCountry) {
        const detectedCountryData = countries.find((c) => c.code === detectedCountry);
        if (detectedCountryData && detectedCountryData.code !== selectedCountry?.code) {
          setSelectedCountry(detectedCountryData);
        }
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (value && selectedCountry) {
      const formatted = formatPhoneNumber(value, selectedCountry.code);
      setValue(formatted);
    }
  };

  return { handleCountryClick, handleCountryClose, handleCountrySelect, handleChange, handleBlur };
};
