import Box from '@mui/material/Box/index.js';
import Fade from '@mui/material/Fade/index.js';
import LinearProgress from '@mui/material/LinearProgress/index.js';
import Paper from '@mui/material/Paper/index.js';
import Portal from '@mui/material/Portal/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import type { FC} from 'react';
import React, {  } from 'react';

import { scrim, sheen } from '../../../tokens/ink';
import { ABSOLUTE_INK } from '../../../tokens/ink.core';
import { rem, remPx, rems } from '../../../tokens/relative';

import { useTutorialOverlay } from './TutorialOverlay.hooks';
import { TutorialStepBody } from './TutorialStepBody';
import type { TutorialOverlayProps } from './TutorialOverlay.types';

// Animation keyframes — the ring's sheen is the absolute white; its reach follows the type scale.
const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 ${alpha(ABSOLUTE_INK.white, 0.7)};
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 20)} ${alpha(ABSOLUTE_INK.white, 0)};
  }
  100% {
    box-shadow: 0 0 0 0 ${alpha(ABSOLUTE_INK.white, 0)};
  }
`;

const floatAnimation = (theme: Theme) => keyframes`
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(${rem(theme, -10)});
  }
`;

// Styled components
const Overlay = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'allowClickThrough' })<{ allowClickThrough?: boolean }>(({ theme, allowClickThrough }) => ({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: theme.zIndex.modal + 100,
  pointerEvents: allowClickThrough ? 'none' : 'auto',
  transition: 'opacity 0.3s ease' }));

const Backdrop = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: scrim(theme, 0.7),
  backdropFilter: `blur(${rem(theme, 2)})` }));

const Spotlight = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'bounds' && prop !== 'padding' })<{ bounds: globalThis.DOMRect; padding: number }>(({ theme, bounds, padding }) => {
  // `bounds` is the target's measured rect; the design-px clearance joins it as px.
  const clearance = remPx(theme, padding);
  return {
    position: 'absolute',
    top: bounds.top - clearance,
    left: bounds.left - clearance,
    width: bounds.width + clearance * 2,
    height: bounds.height + clearance * 2,
    borderRadius: rem(theme, 8),
    border: `${rem(theme, 2)} solid ${sheen(theme, 0.5)}`,
    animation: `${pulseAnimation(theme)} 2s infinite`,
    pointerEvents: 'none',
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: rem(theme, -2),
      borderRadius: rem(theme, 8),
      background: 'transparent',
      boxShadow: `${rems(theme, 0, 0, 0, 9999)} ${scrim(theme, 0.7)}` } };
});

const TooltipContainer = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'placement' })<{ placement: string }>(({ theme, placement }) => ({
  position: 'absolute',
  maxWidth: rem(theme, 360),
  padding: theme.spacing(3),
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
  backdropFilter: `blur(${rem(theme, 20)})`,
  WebkitBackdropFilter: `blur(${rem(theme, 20)})`,
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  boxShadow: theme.shadows[12],
  animation: `${floatAnimation(theme)} 3s ease-in-out infinite`,
  pointerEvents: 'auto',
  zIndex: theme.zIndex.modal + 101,
  '&::before': {
    content: '""',
    position: 'absolute',
    width: rem(theme, 12),
    height: rem(theme, 12),
    background: 'inherit',
    transform: 'rotate(45deg)',
    border: 'inherit',
    ...(placement === 'top' && {
      bottom: rem(theme, -7),
      left: '50%',
      marginLeft: rem(theme, -6),
      borderTop: 'none',
      borderLeft: 'none' }),
    ...(placement === 'bottom' && {
      top: rem(theme, -7),
      left: '50%',
      marginLeft: rem(theme, -6),
      borderBottom: 'none',
      borderRight: 'none' }),
    ...(placement === 'left' && {
      right: rem(theme, -7),
      top: '50%',
      marginTop: rem(theme, -6),
      borderLeft: 'none',
      borderBottom: 'none' }),
    ...(placement === 'right' && {
      left: rem(theme, -7),
      top: '50%',
      marginTop: rem(theme, -6),
      borderRight: 'none',
      borderTop: 'none' }) } }));

const ProgressBar = styled(LinearProgress)(({ theme }) => ({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: rem(theme, 4),
  zIndex: theme.zIndex.modal + 102,
  '& .MuiLinearProgress-bar': {
    background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.light} 100%)` } }));

type TutorialDefaultedKeys =
  | 'initialStep'
  | 'active'
  | 'showProgress'
  | 'allowKeyboardNavigation'
  | 'allowClickThrough'
  | 'variant'
  | 'allowSkip'
  | 'animated';

type ResolvedTutorialProps = TutorialOverlayProps &
  Required<Pick<TutorialOverlayProps, TutorialDefaultedKeys>>;

const TUTORIAL_DEFAULTS: Pick<TutorialOverlayProps, TutorialDefaultedKeys> = {
  initialStep: 0,
  active: true,
  showProgress: true,
  allowKeyboardNavigation: true,
  allowClickThrough: false,
  variant: 'tooltip',
  allowSkip: false,
  animated: true };

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put eight
// branches into the component's own complexity budget.
const resolveProps = (props: TutorialOverlayProps): ResolvedTutorialProps =>
  ({
    ...TUTORIAL_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<TutorialOverlayProps>) }) as ResolvedTutorialProps;

// The dimming layer and the cut-out over the highlighted element. Local because
// Backdrop and Spotlight cannot cross a module boundary (TS2742).
const TutorialLayers: React.FC<{
  variant: string;
  targetBounds: globalThis.DOMRect | null;
  isVisible: boolean;
  spotlightPadding?: number;
}> = ({ variant, targetBounds, isVisible, spotlightPadding }) => {
  const isSpotlight = variant === 'spotlight' || variant === 'highlight';
  const dimmed = variant === 'modal' || isSpotlight;

  return (
    <>
      {dimmed && <Backdrop />}
      {targetBounds && isVisible && isSpotlight && (
        <Spotlight
          bounds={targetBounds}
          padding={spotlightPadding || 8}
          data-testid="tutorial-highlight"
        />
      )}
    </>
  );
};

// The positioned card. Local because TooltipContainer cannot cross a module
// boundary (TS2742).
const TutorialTooltip: React.FC<{
  tutorial: ReturnType<typeof useTutorialOverlay> & {
    currentStepData: TutorialOverlayProps['steps'][number];
  };
  steps: TutorialOverlayProps['steps'];
  allowSkip: boolean;
  showProgress: boolean;
  animated: boolean;
  requiresActionBeforeNext: boolean;
  copy: TutorialOverlayProps['copy'];
}> = ({
  tutorial,
  steps,
  allowSkip,
  showProgress,
  animated,
  requiresActionBeforeNext,
  copy,
}) => (
        <Fade in={tutorial.isVisible} timeout={300}>
          <TooltipContainer
            ref={tutorial.tooltipRef}
            placement={tutorial.actualPlacement}
            elevation={12}
            style={{
              top: tutorial.tooltipPosition.top,
              left: tutorial.tooltipPosition.left,
              animation: animated ? undefined : 'none' }}
            role="dialog"
            aria-labelledby={`tutorial-title-${tutorial.currentStep}`}
            aria-describedby={`tutorial-content-${tutorial.currentStep}`}
            data-testid={`tutorial-step-${tutorial.currentStep}`}
          >
            <TutorialStepBody
              copy={copy}
              step={tutorial.currentStepData}
              currentStep={tutorial.currentStep}
              stepCount={steps.length}
              progress={tutorial.progress}
              isLastStep={tutorial.isLastStep}
              allowSkip={allowSkip}
              showProgress={showProgress}
              requiresActionBeforeNext={requiresActionBeforeNext}
              onNext={tutorial.handleNext}
              onPrev={tutorial.handlePrev}
              onSkip={tutorial.handleSkip}
              onRestart={tutorial.handleRestart}
            />
          </TooltipContainer>
        </Fade>
);

export const TutorialOverlay: FC<TutorialOverlayProps> = (componentProps) => {
  const {
    copy,
    steps,
    onComplete,
    onSkip,
    onStepComplete,
    initialStep,
    active,
    showProgress,
    allowKeyboardNavigation,
    allowClickThrough,
    variant,
    allowSkip,
    animated } = resolveProps(componentProps);

  const tutorial = useTutorialOverlay({
    steps,
    initialStep,
    active,
    allowKeyboardNavigation,
    onComplete,
    onSkip,
    onStepComplete });
  const { currentStepData, isLastStep, isVisible, targetBounds, progress } = tutorial;

  const requiresActionBeforeNext = Boolean(currentStepData?.requiresAction) && !isLastStep;

  if (!active || !currentStepData) return null;

  // Handle empty steps array
  if (steps.length === 0) return null;

  return (
    <Portal>
      <Overlay allowClickThrough={allowClickThrough} data-testid="tutorial-overlay">
        {showProgress && <ProgressBar variant="determinate" value={progress} />}

        <TutorialLayers
          variant={variant}
          targetBounds={targetBounds}
          isVisible={isVisible}
          spotlightPadding={currentStepData.spotlightPadding}
        />

        <TutorialTooltip
          copy={copy}
          tutorial={{ ...tutorial, currentStepData }}
          steps={steps}
          allowSkip={allowSkip}
          showProgress={showProgress}
          animated={animated}
          requiresActionBeforeNext={requiresActionBeforeNext}
        />
      </Overlay>
    </Portal>
  );
};

// Export default
export default TutorialOverlay;
