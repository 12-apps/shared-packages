import type { FormsMessages } from './messages';

/**
 * The en-US sentences — a NAMED export a host passes by hand, exactly as
 * `PT_BR_FORMS_MESSAGES`. They match what the package falls back to.
 */
export const EN_US_FORMS_MESSAGES: FormsMessages = {
  genericError: 'Something went wrong. Please try again.',
  required: 'This field is required',
  email: 'Enter a valid email address',
  minLength: (length: number): string => `Must be at least ${length} characters`,
};
