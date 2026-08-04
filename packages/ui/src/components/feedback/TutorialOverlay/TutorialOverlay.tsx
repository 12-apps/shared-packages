import {
  alpha,
  Box,
  Fade,
  keyframes,
  LinearProgress,
  Paper,
  Portal,
  styled,
} from '@mui/material';
import type { FC} from 'react';
import React from 'react';

import { useTutorialOverlay } from './TutorialOverlay.hooks';
import type { TutorialOverlayProps } from './TutorialOverlay.types';
import { TutorialStepBody } from './TutorialStep';

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

// Prop defaults resolve here rather than in the component's parameter list:
// eight `= default` branches would leave the render no budget of its own.
type Options = Pick<
  TutorialOverlayProps,
  | 'initialStep'
  | 'active'
  | 'showProgress'
  | 'allowKeyboardNavigation'
  | 'allowClickThrough'
  | 'variant'
  | 'allowSkip'
  | 'animated'
>;

const resolveOptions = ({
  initialStep = 0,
  active = true,
  showProgress = true,
  allowKeyboardNavigation = true,
  allowClickThrough = false,
  variant = 'tooltip',
  allowSkip = false,
  animated = true,
}: Options) => ({
  initialStep,
  active,
  showProgress,
  allowKeyboardNavigation,
  allowClickThrough,
  variant,
  allowSkip,
  animated,
});

// What sits behind the tooltip: the dimming backdrop, and the cut-out that
// draws attention to the step's target.
const OverlayLayers: React.FC<{
  variant: string;
  bounds: ReturnType<typeof useTutorialOverlay>['targetBounds'];
  isVisible: boolean;
  spotlightPadding?: number;
}> = ({ variant, bounds, isVisible, spotlightPadding }) => {
  const isSpotlight = variant === 'spotlight' || variant === 'highlight';

  return (
    <>
      {(variant === 'modal' || isSpotlight) && <Backdrop />}

      {bounds && isVisible && isSpotlight && (
        <Spotlight
          bounds={bounds}
          padding={spotlightPadding || 8}
          data-testid="tutorial-highlight"
        />
      )}
    </>
  );
};

// Main component
export const TutorialOverlay: FC<TutorialOverlayProps> = (props) => {
  const { steps, onComplete, onSkip, onStepComplete } = props;
  const {
    initialStep, active, showProgress, allowKeyboardNavigation,
    allowClickThrough, variant, allowSkip, animated,
  } = resolveOptions(props);
  const {
    currentStep, currentStepData, isLastStep, isVisible, targetBounds, tooltipRef,
    tooltipPosition, actualPlacement, progress, handleNext, handlePrev, handleSkip,
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

  if (!active || !currentStepData) return null;

  // Handle empty steps array
  if (steps.length === 0) return null;

  return (
    <Portal>
      <Overlay allowClickThrough={allowClickThrough} data-testid="tutorial-overlay">
        {showProgress && <ProgressBar variant="determinate" value={progress} />}

        <OverlayLayers
          variant={variant}
          bounds={targetBounds}
          isVisible={isVisible}
          spotlightPadding={currentStepData.spotlightPadding}
        />

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
              requiresActionBeforeNext={currentStepData.requiresAction && !isLastStep}
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
