import CloseIcon from '@mui/icons-material/Close';
import CompleteIcon from '@mui/icons-material/Done';
import NextIcon from '@mui/icons-material/NavigateNext';
import PrevIcon from '@mui/icons-material/NavigateBefore';
import RestartIcon from '@mui/icons-material/RestartAlt';
import { alpha, Box, Button, IconButton, Stack, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { TutorialOverlayProps } from './TutorialOverlay.types';

type Step = TutorialOverlayProps['steps'][number];

const StepIndicator = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(2),
}));

const StepDot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active' && prop !== 'completed',
})<{ active?: boolean; completed?: boolean }>(({ theme, active, completed }) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: completed
    ? theme.palette.success.main
    : active
      ? theme.palette.primary.main
      : alpha(theme.palette.text.primary, 0.3),
  transition: 'all 0.3s ease',
  ...(active && {
    transform: 'scale(1.5)',
  }),
}));

const StepHeader: React.FC<{
  title: React.ReactNode;
  currentStep: number;
  allowSkip: boolean;
  onSkip: () => void;
}> = ({ title, currentStep, allowSkip, onSkip }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
    <Typography
      id={`tutorial-title-${currentStep}`}
      variant="h6"
      fontWeight="bold"
      sx={{ flex: 1 }}
      data-testid="tutorial-step-title"
    >
      {title}
    </Typography>
    {allowSkip && (
      <IconButton
        size="small"
        onClick={onSkip}
        sx={{ ml: 1, mt: -1, mr: -1 }}
        data-testid="tutorial-close-button"
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    )}
  </Box>
);

const StepDots: React.FC<{ currentStep: number; stepCount: number }> = ({
  currentStep,
  stepCount,
}) => (
  <StepIndicator data-testid="tutorial-step-indicators">
    {Array.from({ length: stepCount }).map((_, index) => (
      <StepDot
        key={index}
        active={index === currentStep}
        completed={index < currentStep}
        data-testid={`tutorial-indicator-${index}`}
      />
    ))}
  </StepIndicator>
);

// Skip and restart: what you do instead of advancing.
const StepAsideActions: React.FC<{
  currentStep: number;
  stepCount: number;
  allowSkip: boolean;
  onSkip: () => void;
  onRestart: () => void;
}> = ({ currentStep, stepCount, allowSkip, onSkip, onRestart }) => (
  <Stack direction="row" spacing={1}>
    {allowSkip && (
      <Button size="small" onClick={onSkip} variant="text">
        Skip
      </Button>
    )}
    {stepCount > 1 && (
      <IconButton size="small" onClick={onRestart} disabled={currentStep === 0} title="Restart">
        <RestartIcon fontSize="small" />
      </IconButton>
    )}
  </Stack>
);

// The last step finishes the tutorial rather than advancing it, and a step that
// demands an action holds Next shut until it happens.
const StepAdvanceActions: React.FC<{
  currentStep: number;
  stepCount: number;
  isLastStep: boolean;
  requiresActionBeforeNext?: boolean;
  onNext: () => void;
  onPrev: () => void;
}> = ({ currentStep, stepCount, isLastStep, requiresActionBeforeNext, onNext, onPrev }) => (
  <Stack direction="row" spacing={1}>
    {stepCount > 1 && currentStep > 0 && (
      <Button
        size="small"
        startIcon={<PrevIcon />}
        onClick={onPrev}
        disabled={currentStep === 0}
        data-testid="tutorial-prev-button"
      >
        Previous
      </Button>
    )}

    {!isLastStep ? (
      <Button
        variant="contained"
        size="small"
        endIcon={<NextIcon />}
        onClick={onNext}
        disabled={requiresActionBeforeNext}
        title={requiresActionBeforeNext ? 'Complete the required action first' : ''}
        data-testid="tutorial-next-button"
      >
        Next
      </Button>
    ) : (
      <Button
        variant="contained"
        size="small"
        endIcon={<CompleteIcon />}
        onClick={onNext}
        sx={{ background: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' }}
        data-testid="tutorial-finish-button"
      >
        {stepCount === 1 ? 'Complete' : 'Finish'}
      </Button>
    )}
  </Stack>
);

// Title, body copy, the step dots and the navigation row.
export const TutorialStepBody: React.FC<{
  step: Step;
  currentStep: number;
  stepCount: number;
  progress: number;
  isLastStep: boolean;
  allowSkip: boolean;
  showProgress: boolean;
  requiresActionBeforeNext?: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onRestart: () => void;
}> = ({
  step,
  currentStep,
  stepCount,
  isLastStep,
  allowSkip,
  showProgress,
  requiresActionBeforeNext,
  onNext,
  onPrev,
  onSkip,
  onRestart,
}) => (
  <Stack spacing={2}>
    <StepHeader
      title={step.title}
      currentStep={currentStep}
      allowSkip={allowSkip}
      onSkip={onSkip}
    />

    <Typography
      id={`tutorial-content-${currentStep}`}
      variant="body2"
      color="text.secondary"
      data-testid="tutorial-step-content"
    >
      {step.content}
    </Typography>

    {showProgress && (
      <Typography variant="caption" color="text.secondary" align="center">
        {currentStep + 1} of {stepCount}
      </Typography>
    )}

    {step.action && (
      <Button
        variant="contained"
        size="small"
        onClick={step.action.onClick}
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
        }}
      >
        {step.action.label}
      </Button>
    )}

    <StepDots currentStep={currentStep} stepCount={stepCount} />

    <Stack
      direction="row"
      spacing={1}
      justifyContent="space-between"
      data-testid="tutorial-navigation"
    >
      <StepAsideActions
        currentStep={currentStep}
        stepCount={stepCount}
        allowSkip={allowSkip}
        onSkip={onSkip}
        onRestart={onRestart}
      />

      <StepAdvanceActions
        currentStep={currentStep}
        stepCount={stepCount}
        isLastStep={isLastStep}
        requiresActionBeforeNext={requiresActionBeforeNext}
        onNext={onNext}
        onPrev={onPrev}
      />
    </Stack>
  </Stack>
);
