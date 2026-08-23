import type { CountryCode } from 'libphonenumber-js';
import type { PhoneInputCopy } from '../../../copy';

export interface PhoneInputProps {
  /**
   * Every word this field renders on its own account — the picker's accessible
   * name and the invalid-number sentence. REQUIRED: this package ships no
   * default copy, and the shopper reads both at the checkout.
   */
  copy: PhoneInputCopy;
  variant?: 'glass' | 'outlined' | 'filled';
  label?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  defaultValue?: string;
  countryCode?: CountryCode;
  floating?: boolean;
  onChange?: (value: string, isValid: boolean, countryCode?: CountryCode) => void;
  helper?: string;
  error?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
}

export interface CountryData {
  code: CountryCode;
  name: string;
  dial: string;
  flag: string;
}
