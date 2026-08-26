import SecurityIcon from '@mui/icons-material/Security';
import SuccessIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { PasswordRequirementCopy, PasswordStrengthCopy } from '../../../copy';
import type { PasswordRequirements } from './PasswordStrength.types';

export const defaultRequirements: PasswordRequirements = {
  minLength: 8,
  uppercase: true,
  lowercase: true,
  numbers: true,
  special: true,
};


const SPECIAL_CHARACTERS = /[!@#$%^&*(),.?":{}|<>]/;
const DEFAULT_MIN_LENGTH = 8;

// Points awarded per satisfied requirement.
const REQUIREMENT_POINTS = {
  length: 20,
  uppercase: 10,
  lowercase: 10,
  numbers: 15,
  special: 15,
} as const;

export type RequirementChecks = Record<keyof typeof REQUIREMENT_POINTS, boolean>;

// A requirement that is switched off counts as satisfied. This was previously
// written out twice — once to score the password and once to render the
// checklist — so the two could drift.
export const evaluateRequirements = (
  password: string,
  requirements: PasswordRequirements,
): RequirementChecks => {
  if (!password) {
    return { length: false, uppercase: false, lowercase: false, numbers: false, special: false };
  }

  return {
    length: password.length >= (requirements.minLength || DEFAULT_MIN_LENGTH),
    uppercase: !requirements.uppercase || /[A-Z]/.test(password),
    lowercase: !requirements.lowercase || /[a-z]/.test(password),
    numbers: !requirements.numbers || /\d/.test(password),
    special: !requirements.special || SPECIAL_CHARACTERS.test(password),
  };
};

const lengthBonus = (length: number): number => {
  const base = Math.min(length * 3, 30);
  const over12 = length > 12 ? 10 : 0;
  const over16 = length > 16 ? 10 : 0;

  return base + over12 + over16;
};

export const calculatePasswordStrength = (
  password: string,
  requirements: PasswordRequirements,
): number => {
  if (!password) return 0;

  const checks = evaluateRequirements(password, requirements);
  const earned = Object.entries(REQUIREMENT_POINTS).reduce(
    (total, [key, points]) => total + (checks[key as keyof RequirementChecks] ? points : 0),
    0,
  );

  return Math.min(earned + lengthBonus(password.length), 100);
};

// The four ceilings, and which band each one names. The band NAMES come from
// the host's table — only the thresholds are ours.
const STRENGTH_BANDS: ReadonlyArray<[number, keyof PasswordStrengthCopy['bands']]> = [
  [20, 'veryWeak'],
  [40, 'weak'],
  [60, 'fair'],
  [80, 'good'],
];

export const getStrengthLabel = (
  strength: number,
  bands: PasswordStrengthCopy['bands'],
): string => bands[STRENGTH_BANDS.find(([ceiling]) => strength <= ceiling)?.[1] ?? 'strong'];

export const getStrengthIcon = (strength: number) => {
  if (strength <= 40) return <WarningIcon />;
  if (strength <= 80) return <SecurityIcon />;
  return <SuccessIcon />;
};

// One tip per unmet requirement, in checklist order. The `length` tip carries
// the configured minimum, so the number in the sentence is the one enforced.
const SUGGESTION_KEYS: ReadonlyArray<[keyof RequirementChecks, keyof PasswordRequirementCopy]> = [
  ['length', 'minLength'],
  ['uppercase', 'uppercase'],
  ['lowercase', 'lowercase'],
  ['numbers', 'numbers'],
  ['special', 'special'],
];

export const buildSuggestions = (
  checks: RequirementChecks,
  copy: PasswordRequirementCopy,
  minLength: number,
): string[] =>
  SUGGESTION_KEYS.filter(([check]) => !checks[check]).map(([, key]) =>
    key === 'minLength' ? copy.minLength(minLength) : copy[key],
  );

// Rendered by PasswordStrength; depends on nothing styled, so it lives beside
// the pure helpers rather than in the component file.
export const SuggestionsList: React.FC<{ suggestions: string[]; heading: string }> = ({
  suggestions,
  heading,
}) => (
  <Box>
    <Typography variant="caption" color="text.secondary" fontWeight="medium">
      {heading}
    </Typography>
    <Box sx={{ mt: 1 }}>
      {suggestions.map((tip) => (
        <Typography key={tip} variant="caption" display="block" color="warning.main" sx={{ ml: 2 }}>
          • {tip}
        </Typography>
      ))}
    </Box>
  </Box>
);
