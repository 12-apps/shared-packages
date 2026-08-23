import type { PasswordStrengthCopy } from '../../../copy';

export interface PasswordRequirements {
  minLength?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  special?: boolean;
}

export interface PasswordStrengthProps {
  /**
   * Every word the meter renders: the three headings, the five strength bands,
   * the checklist and the tips. REQUIRED: this package ships no default copy,
   * and eighteen sentences is exactly the size that used to make an English
   * default look like a component and not like a leak.
   */
  copy: PasswordStrengthCopy;
  value: string;
  showRequirements?: boolean;
  requirements?: PasswordRequirements;
  showStrengthLabel?: boolean;
  showSuggestions?: boolean;
  variant?: 'linear' | 'circular' | 'steps';
  animated?: boolean;
  'data-testid'?: string;
}
