import SuccessIcon from '@mui/icons-material/CheckCircle';
import SecurityIcon from '@mui/icons-material/Security';
import WarningIcon from '@mui/icons-material/Warning';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';

import {
  alpha,
  Box,
  Chip,
  Fade,
  keyframes,
  LinearProgress,
  Stack,
  styled,
  Typography,
  useTheme,
} from '@mui/material';
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
  SuggestionsList,
} from './PasswordStrength.helpers';
import type { PasswordRequirements, PasswordStrengthProps } from './PasswordStrength.types';

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

const slideInAnimation = keyframes`
  from {
    transform: translateX(-10px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
`;

// Styled components
const StrengthContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'animated',
})<{ animated?: boolean }>(({ theme, animated }) => ({
  width: '100%',
  padding: theme.spacing(2),
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
  transition: animated ? 'all 0.3s ease' : 'none',
}));

const StrengthBar = styled(LinearProgress, {
  shouldForwardProp: (prop) => prop !== 'strength' && prop !== 'animated',
})<{ strength: number; animated?: boolean }>(({ theme, strength, animated }) => {
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
    height: 8,
    borderRadius: 4,
    backgroundColor: alpha(theme.palette.action.disabled, 0.1),
    '& .MuiLinearProgress-bar': {
      borderRadius: 4,
      background: getGradient(),
      transition: animated ? 'all 0.3s ease' : 'none',
      boxShadow: `0 2px 8px ${alpha(getColor(), 0.3)}`,
    },
  };
});

const RequirementItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'met' && prop !== 'animated',
})<{ met: boolean; animated?: boolean }>(({ theme, met, animated }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(0.75, 1),
  borderRadius: theme.shape.borderRadius,
  background: met
    ? alpha(theme.palette.success.main, 0.08)
    : alpha(theme.palette.action.disabled, 0.04),
  transition: animated ? 'all 0.3s ease' : 'none',
  animation: animated ? `${slideInAnimation} 0.3s ease` : 'none',
  '& svg': {
    fontSize: '1rem',
    color: met ? theme.palette.success.main : theme.palette.text.disabled,
  },
}));

const StrengthLabel = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'strength' && prop !== 'animated',
})<{ strength: number; animated?: boolean }>(({ theme, strength, animated }) => {
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
    animation: animated ? `${pulseAnimation} 2s ease infinite` : 'none',
  };
});

const StepsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  marginTop: theme.spacing(2),
}));

const Step = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active' && prop !== 'completed' && prop !== 'animated',
})<{ active: boolean; completed: boolean; animated?: boolean }>(
  ({ theme, active, completed, animated }) => ({
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: completed
      ? `linear-gradient(90deg, ${theme.palette.success.main} 0%, ${theme.palette.success.light} 100%)`
      : active
        ? `linear-gradient(90deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.light} 100%)`
        : alpha(theme.palette.action.disabled, 0.2),
    transition: animated ? 'all 0.3s ease' : 'none',
    boxShadow: completed ? `0 2px 8px ${alpha(theme.palette.success.main, 0.3)}` : 'none',
  }),
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
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: `conic-gradient(
                ${theme.palette.success.main} 0deg ${strength * 3.6}deg,
                ${alpha(theme.palette.action.disabled, 0.1)} ${strength * 3.6}deg 360deg
              )`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 12px ${alpha(theme.palette.success.main, strength / 200)}`,
            }}
          >
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: theme.palette.background.paper,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
              }}
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
  strength: number;
  hasValue: boolean;
  animated: boolean;
}> = ({ strength, hasValue, animated }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      Password Strength
    </Typography>
    {hasValue && (
      <Fade in={true}>
        <StrengthLabel
          label={getStrengthLabel(strength)}
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
const RequirementsList: React.FC<{
  requirements: PasswordRequirements;
  checks: RequirementChecks;
  animated: boolean;
}> = ({ requirements, checks, animated }) => {
  const rows: ReadonlyArray<[unknown, keyof RequirementChecks, React.ReactNode]> = [
    [requirements.minLength, 'length', `At least ${requirements.minLength} characters`],
    [requirements.uppercase, 'uppercase', 'One uppercase letter'],
    [requirements.lowercase, 'lowercase', 'One lowercase letter'],
    [requirements.numbers, 'numbers', 'One number'],
    [requirements.special, 'special', 'One special character'],
  ];

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary" fontWeight="medium">
        Requirements:
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
};

// The visible sections. Kept apart from PasswordStrength itself so the exported
// component is just prop defaults plus the three memos, and every display guard
// lives in one place.
const PasswordStrengthBody: React.FC<{
  value: string;
  strength: number;
  requirements: PasswordRequirements;
  requirementChecks: RequirementChecks;
  suggestions: string[];
  showStrengthLabel: boolean;
  showRequirements: boolean;
  showSuggestions: boolean;
  variant: PasswordStrengthProps['variant'];
  animated: boolean;
}> = ({
  value,
  strength,
  requirements,
  requirementChecks,
  suggestions,
  showStrengthLabel,
  showRequirements,
  showSuggestions,
  variant,
  animated,
}) => (
    <Stack spacing={2}>
      {showStrengthLabel && (
        <StrengthHeading strength={strength} hasValue={value.length > 0} animated={animated} />
      )}

      <StrengthIndicator variant={variant} strength={strength} animated={animated} />

      {showRequirements && (
        <Fade in={value.length > 0}>
          <RequirementsList
            requirements={requirements}
            checks={requirementChecks}
            animated={animated}
          />
        </Fade>
      )}

      {showSuggestions && suggestions.length > 0 && value.length > 0 && (
        <Fade in={true}>
          <SuggestionsList suggestions={suggestions} />
        </Fade>
      )}
    </Stack>
);

// Main component
export const PasswordStrength: FC<PasswordStrengthProps> = ({
  value = '',
  showRequirements = true,
  requirements = defaultRequirements,
  showStrengthLabel = true,
  showSuggestions = false,
  variant = 'linear',
  animated = true,
  'data-testid': dataTestId,
}) => {
  const theme = useTheme();

  const strength = useMemo(
    () => calculatePasswordStrength(value, requirements),
    [value, requirements],
  );

  const requirementChecks = useMemo(
    () => evaluateRequirements(value, requirements),
    [value, requirements],
  );

  const suggestions = useMemo(() => buildSuggestions(requirementChecks), [requirementChecks]);

  return (
    <StrengthContainer animated={animated} data-testid={dataTestId}>
      <PasswordStrengthBody
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
