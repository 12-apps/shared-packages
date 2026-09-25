import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

import Box from '@mui/material/Box/index.js';
import Chip from '@mui/material/Chip/index.js';
import Fade from '@mui/material/Fade/index.js';
import LinearProgress from '@mui/material/LinearProgress/index.js';
import Stack from '@mui/material/Stack/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import { alpha, keyframes, styled, useTheme } from '@mui/material/styles/index.js';
import type { FC} from 'react';
import React, { useMemo } from 'react';

import type { RequirementChecks } from './PasswordStrength.helpers';
import {
  buildSuggestions,
  calculatePasswordStrength,
  defaultRequirements,
  evaluateRequirements,
  getStrengthIcon,
  getStrengthLabel,
  SuggestionsList } from './PasswordStrength.helpers';
import type { PasswordRequirements, PasswordStrengthProps } from './PasswordStrength.types';
import type { PasswordStrengthCopy } from '../../../copy';
import { rem, rems, sxRem } from '../../../tokens/relative';

interface RequirementIconProps {
  met: boolean;
}
 const RequirementIcon: FC<RequirementIconProps> = ({ met }) => {
  return met ? (
    <CheckIcon data-testid="check-icon" />
  ) : (
    <CloseIcon data-testid="close-icon" />
  );
};

// Default requirements
// Animation keyframes
const pulseAnimation = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
`;

const slideInAnimation = (theme: Theme) => keyframes`
  from {
    transform: translateX(${rem(theme, -10)});
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
`;

// Styled components
const StrengthContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'animated' })<{ animated?: boolean }>(({ theme, animated }) => ({
  width: '100%',
  padding: theme.spacing(2),
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
  backdropFilter: `blur(${rem(theme, 10)})`,
  WebkitBackdropFilter: `blur(${rem(theme, 10)})`,
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
  transition: animated ? 'all 0.3s ease' : 'none' }));

const StrengthBar = styled(LinearProgress, {
  shouldForwardProp: (prop) => prop !== 'strength' && prop !== 'animated' })<{ strength: number; animated?: boolean }>(({ theme, strength, animated }) => {
  const getColor = () => {
    if (strength <= 20) return theme.palette.error.main;
    if (strength <= 40) return theme.palette.warning.main;
    if (strength <= 60) return theme.palette.info.main;
    if (strength <= 80) return theme.palette.success.light;
    return theme.palette.success.main;
  };

  const getGradient = () => {
    const color = getColor();
    return `linear-gradient(90deg, ${color} 0%, ${alpha(color, 0.8)} 100%)`;
  };

  return {
    height: rem(theme, 8),
    borderRadius: rem(theme, 4),
    backgroundColor: alpha(theme.palette.action.disabled, 0.1),
    '& .MuiLinearProgress-bar': {
      borderRadius: rem(theme, 4),
      background: getGradient(),
      transition: animated ? 'all 0.3s ease' : 'none',
      boxShadow: `0 ${rems(theme, 2, 8)} ${alpha(getColor(), 0.3)}` } };
});

const RequirementItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'met' && prop !== 'animated' })<{ met: boolean; animated?: boolean }>(({ theme, met, animated }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(0.75, 1),
  borderRadius: theme.shape.borderRadius,
  background: met
    ? alpha(theme.palette.success.main, 0.08)
    : alpha(theme.palette.action.disabled, 0.04),
  transition: animated ? 'all 0.3s ease' : 'none',
  animation: animated ? `${slideInAnimation(theme)} 0.3s ease` : 'none',
  '& svg': {
    fontSize: rem(theme, 16),
    color: met ? theme.palette.success.main : theme.palette.text.disabled } }));

const StrengthLabel = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'strength' && prop !== 'animated' })<{ strength: number; animated?: boolean }>(({ theme, strength, animated }) => {
  const getColor = () => {
    if (strength <= 20) return theme.palette.error;
    if (strength <= 40) return theme.palette.warning;
    if (strength <= 60) return theme.palette.info;
    if (strength <= 80) return theme.palette.success;
    return theme.palette.success;
  };

  const palette = getColor();

  return {
    background: alpha(palette.main, 0.1),
    color: palette.main,
    border: `1px solid ${alpha(palette.main, 0.3)}`,
    fontWeight: 600,
    animation: animated ? `${pulseAnimation} 2s ease infinite` : 'none' };
});

const StepsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  marginTop: theme.spacing(2) }));

const Step = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active' && prop !== 'completed' && prop !== 'animated' })<{ active: boolean; completed: boolean; animated?: boolean }>(
  ({ theme, active, completed, animated }) => ({
    flex: 1,
    height: rem(theme, 6),
    borderRadius: rem(theme, 3),
    background: completed
      ? `linear-gradient(90deg, ${theme.palette.success.main} 0%, ${theme.palette.success.light} 100%)`
      : active
        ? `linear-gradient(90deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.light} 100%)`
        : alpha(theme.palette.action.disabled, 0.2),
    transition: animated ? 'all 0.3s ease' : 'none',
    boxShadow: completed ? `0 ${rems(theme, 2, 8)} ${alpha(theme.palette.success.main, 0.3)}` : 'none' }),
);

// The three indicator variants, out of the component body so the render keeps
// only its own layout branches.
const StrengthIndicator: React.FC<{
  variant: PasswordStrengthProps['variant'];
  strength: number;
  animated: boolean;
}> = ({ variant, strength, animated }) => {
  const theme = useTheme();

  switch (variant) {
    case 'circular':
      return (
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <Box
            sx={{
              width: sxRem(80),
              height: sxRem(80),
              borderRadius: '50%',
              background: `conic-gradient(
                ${theme.palette.success.main} 0deg ${strength * 3.6}deg,
                ${alpha(theme.palette.action.disabled, 0.1)} ${strength * 3.6}deg 360deg
              )`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 ${rems(theme, 4, 12)} ${alpha(theme.palette.success.main, strength / 200)}` }}
          >
            <Box
              sx={{
                width: sxRem(64),
                height: sxRem(64),
                borderRadius: '50%',
                background: theme.palette.background.paper,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column' }}
            >
              <Typography variant="h6" fontWeight="bold">
                {strength}%
              </Typography>
            </Box>
          </Box>
        </Box>
      );

    case 'steps': {
      const steps = 5;
      const activeStep = Math.ceil((strength / 100) * steps);
      return (
        <StepsContainer>
          {Array.from({ length: steps }, (_, i) => (
            <Step key={i} active={i === activeStep - 1} completed={i < activeStep - 1} animated={animated} />
          ))}
        </StepsContainer>
      );
    }

    default:
      return <StrengthBar variant="determinate" value={strength} strength={strength} animated={animated} />;
  }
};

const StrengthHeading: React.FC<{
  copy: PasswordStrengthCopy;
  strength: number;
  hasValue: boolean;
  animated: boolean;
}> = ({ copy, strength, hasValue, animated }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      {copy.strengthHeading}
    </Typography>
    {hasValue && (
      <Fade in={true}>
        <StrengthLabel
          label={getStrengthLabel(strength, copy.bands)}
          icon={getStrengthIcon(strength)}
          size="small"
          strength={strength}
          animated={animated}
        />
      </Fade>
    )}
  </Box>
);

// One row per enabled requirement. Previously five near-identical JSX blocks,
// each with its own `requirements.x &&` guard.
//
// `forwardRef` because it is `Fade`'s child: Fade hands it a ref and reads
// `scrollTop` off that node on enter, so a component that drops the ref throws
// the moment the first character is typed. Only the ref: Fade's injected
// `style` (opacity/visibility) is still dropped, so the list stays visible.
const RequirementsList = React.forwardRef<
  HTMLDivElement,
  {
    copy: PasswordStrengthCopy;
    requirements: PasswordRequirements;
    checks: RequirementChecks;
    animated: boolean;
  }
>(({ copy, requirements, checks, animated }, ref) => {
  const rows: ReadonlyArray<[unknown, keyof RequirementChecks, React.ReactNode]> = [
    [requirements.minLength, 'length', copy.requirements.minLength(requirements.minLength ?? 0)],
    [requirements.uppercase, 'uppercase', copy.requirements.uppercase],
    [requirements.lowercase, 'lowercase', copy.requirements.lowercase],
    [requirements.numbers, 'numbers', copy.requirements.numbers],
    [requirements.special, 'special', copy.requirements.special],
  ];

  return (
    <Stack ref={ref} spacing={1}>
      <Typography variant="caption" color="text.secondary" fontWeight="medium">
        {copy.requirementsHeading}
      </Typography>
      {rows
        .filter(([enabled]) => Boolean(enabled))
        .map(([, key, label]) => (
          <RequirementItem key={key} met={checks[key]} animated={animated}>
            <RequirementIcon met={checks[key]} />
            <Typography variant="caption">{label}</Typography>
          </RequirementItem>
        ))}
    </Stack>
  );
});
RequirementsList.displayName = 'RequirementsList';

// The visible sections. Kept apart from PasswordStrength itself so the exported
// component is just prop defaults plus the three memos, and every display guard
// lives in one place.
const PasswordStrengthBody: React.FC<{
  value: string;
  strength: number;
  copy: PasswordStrengthCopy;
  requirements: PasswordRequirements;
  requirementChecks: RequirementChecks;
  suggestions: string[];
  showStrengthLabel: boolean;
  showRequirements: boolean;
  showSuggestions: boolean;
  variant: PasswordStrengthProps['variant'];
  animated: boolean;
}> = ({
  copy,
  value,
  strength,
  requirements,
  requirementChecks,
  suggestions,
  showStrengthLabel,
  showRequirements,
  showSuggestions,
  variant,
  animated }) => (
    <Stack spacing={2}>
      {showStrengthLabel && (
        <StrengthHeading
          copy={copy}
          strength={strength}
          hasValue={value.length > 0}
          animated={animated}
        />
      )}

      <StrengthIndicator variant={variant} strength={strength} animated={animated} />

      {showRequirements && (
        <Fade in={value.length > 0}>
          <RequirementsList
            copy={copy}
            requirements={requirements}
            checks={requirementChecks}
            animated={animated}
          />
        </Fade>
      )}

      {showSuggestions && suggestions.length > 0 && value.length > 0 && (
        <Fade in={true}>
          <SuggestionsList suggestions={suggestions} heading={copy.suggestionsHeading} />
        </Fade>
      )}
    </Stack>
);

// Main component
export const PasswordStrength: FC<PasswordStrengthProps> = ({
  copy,
  value = '',
  showRequirements = true,
  requirements = defaultRequirements,
  showStrengthLabel = true,
  showSuggestions = false,
  variant = 'linear',
  animated = true,
  'data-testid': dataTestId }) => {

  const strength = useMemo(
    () => calculatePasswordStrength(value, requirements),
    [value, requirements],
  );

  const requirementChecks = useMemo(
    () => evaluateRequirements(value, requirements),
    [value, requirements],
  );

  const suggestions = useMemo(
    () => buildSuggestions(requirementChecks, copy.suggestions, requirements.minLength ?? 0),
    [requirementChecks, copy.suggestions, requirements.minLength],
  );

  return (
    <StrengthContainer animated={animated} data-testid={dataTestId}>
      <PasswordStrengthBody
        copy={copy}
        value={value}
        strength={strength}
        requirements={requirements}
        requirementChecks={requirementChecks}
        suggestions={suggestions}
        showStrengthLabel={showStrengthLabel}
        showRequirements={showRequirements}
        showSuggestions={showSuggestions}
        variant={variant}
        animated={animated}
      />
    </StrengthContainer>
  );
};

// Export default
export default PasswordStrength;
