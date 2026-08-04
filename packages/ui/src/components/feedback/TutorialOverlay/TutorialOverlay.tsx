import CompleteIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import PrevIcon from '@mui/icons-material/NavigateBefore';
import NextIcon from '@mui/icons-material/NavigateNext';
import RestartIcon from '@mui/icons-material/Refresh';
import {
  alpha,
  Box,
  Button,
  Fade,
  IconButton,
  keyframes,
  LinearProgress,
  Paper,
  Portal,
  Stack,
  styled,
  Typography,
} from '@mui/material';
import type { FC} from 'react';
import React from 'react';

import { useTutorialOverlay } from './TutorialOverlay.hooks';
import type { TutorialOverlayProps } from './TutorialOverlay.types';

// Animation keyframes
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  }
  70% {
    box-shadow: 0 0 0 20px rgba(255, 255, 255, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
  }
`;

const floatAnimation = keyframes`
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
`;

// Styled components
const Overlay = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'allowClickThrough',
})<{ allowClickThrough?: boolean }>(({ theme, allowClickThrough }) => ({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: theme.zIndex.modal + 100,
  pointerEvents: allowClickThrough ? 'none' : 'auto',
  transition: 'opacity 0.3s ease',
}));

const Backdrop = styled(Box)(() => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: alpha('#000', 0.7),
  backdropFilter: 'blur(2px)',
}));

const Spotlight = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'bounds' && prop !== 'padding',
})<{ bounds: globalThis.DOMRect; padding: number }>(({ bounds, padding }) => ({
  position: 'absolute',
  top: bounds.top - padding,
  left: bounds.left - padding,
  width: bounds.width + padding * 2,
  height: bounds.height + padding * 2,
  borderRadius: 8,
  border: '2px solid rgba(255, 255, 255, 0.5)',
  animation: `${pulseAnimation} 2s infinite`,
  pointerEvents: 'none',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: -2,
    borderRadius: 8,
    background: 'transparent',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)',
  },
}));

const TooltipContainer = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'placement',
})<{ placement: string }>(({ theme, placement }) => ({
  position: 'absolute',
  maxWidth: 360,
  padding: theme.spacing(3),
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  boxShadow: theme.shadows[12],
  animation: `${floatAnimation} 3s ease-in-out infinite`,
  pointerEvents: 'auto',
  zIndex: theme.zIndex.modal + 101,
  '&::before': {
    content: '""',
    position: 'absolute',
    width: 12,
    height: 12,
    background: 'inherit',
    transform: 'rotate(45deg)',
    border: 'inherit',
    ...(placement === 'top' && {
      bottom: -7,
      left: '50%',
      marginLeft: -6,
      borderTop: 'none',
      borderLeft: 'none',
    }),
    ...(placement === 'bottom' && {
      top: -7,
      left: '50%',
      marginLeft: -6,
      borderBottom: 'none',
      borderRight: 'none',
    }),
    ...(placement === 'left' && {
      right: -7,
      top: '50%',
      marginTop: -6,
      borderLeft: 'none',
      borderBottom: 'none',
    }),
    ...(placement === 'right' && {
      left: -7,
      top: '50%',
      marginTop: -6,
      borderRight: 'none',
      borderTop: 'none',
    }),
  },
}));

const ProgressBar = styled(LinearProgress)(({ theme }) => ({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: 4,
  zIndex: theme.zIndex.modal + 102,
  '& .MuiLinearProgress-bar': {
    background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.light} 100%)`,
  },
}));

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

// Title, body copy, the step dots and the navigation row.
const TutorialStepBody: React.FC<{
  step: TutorialOverlayProps['steps'][number];
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
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <Typography
            id={`tutorial-title-${currentStep}`}
            variant="h6"
            fontWeight="bold"
            sx={{ flex: 1 }}
            data-testid="tutorial-step-title"
          >
            {step.title}
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

        <Stack
          direction="row"
          spacing={1}
          justifyContent="space-between"
          data-testid="tutorial-navigation"
        >
          <Stack direction="row" spacing={1}>
            {allowSkip && (
              <Button size="small" onClick={onSkip} variant="text">
                Skip
              </Button>
            )}
            {stepCount > 1 && (
              <IconButton
                size="small"
                onClick={onRestart}
                disabled={currentStep === 0}
                title="Restart"
              >
                <RestartIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>

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
                sx={{
                  background: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
                }}
                data-testid="tutorial-finish-button"
              >
                {stepCount === 1 ? 'Complete' : 'Finish'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Stack>
);

// Main component
export const TutorialOverlay: FC<TutorialOverlayProps> = ({
  steps,
  onComplete,
  onSkip,
  onStepComplete,
  initialStep = 0,
  active = true,
  showProgress = true,
  allowKeyboardNavigation = true,
  allowClickThrough = false,
  variant = 'tooltip',
  allowSkip = false,
  animated = true,
}) => {
  const {
    currentStep,
    currentStepData,
    isLastStep,
    isVisible,
    targetBounds,
    tooltipRef,
    tooltipPosition,
    actualPlacement,
    progress,
    handleNext,
    handlePrev,
    handleSkip,
    handleRestart,
  } = useTutorialOverlay({
    steps,
    initialStep,
    active,
    allowKeyboardNavigation,
    onComplete,
    onSkip,
    onStepComplete,
  });

  const isModal = variant === 'modal';
  const isSpotlight = variant === 'spotlight' || variant === 'highlight';
  const requiresActionBeforeNext = currentStepData?.requiresAction && !isLastStep;

  if (!active || !currentStepData) return null;

  // Handle empty steps array
  if (steps.length === 0) return null;

  return (
    <Portal>
      <Overlay allowClickThrough={allowClickThrough} data-testid="tutorial-overlay">
        {showProgress && <ProgressBar variant="determinate" value={progress} />}

        {(isModal || isSpotlight) && <Backdrop />}

        {targetBounds && isVisible && isSpotlight && (
          <Spotlight
            bounds={targetBounds}
            padding={currentStepData.spotlightPadding || 8}
            data-testid="tutorial-highlight"
          />
        )}

        <Fade in={isVisible} timeout={300}>
          <TooltipContainer
            ref={tooltipRef}
            placement={actualPlacement}
            elevation={12}
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              animation: animated ? undefined : 'none',
            }}
            role="dialog"
            aria-labelledby={`tutorial-title-${currentStep}`}
            aria-describedby={`tutorial-content-${currentStep}`}
            data-testid={`tutorial-step-${currentStep}`}
          >
            <TutorialStepBody
              step={currentStepData}
              currentStep={currentStep}
              stepCount={steps.length}
              progress={progress}
              isLastStep={isLastStep}
              allowSkip={allowSkip}
              showProgress={showProgress}
              requiresActionBeforeNext={requiresActionBeforeNext}
              onNext={handleNext}
              onPrev={handlePrev}
              onSkip={handleSkip}
              onRestart={handleRestart}
            />
          </TooltipContainer>
        </Fade>
      </Overlay>
    </Portal>
  );
};

// Export default
export default TutorialOverlay;
