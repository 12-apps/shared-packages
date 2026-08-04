import { useCallback, useEffect, useRef, useState } from 'react';

import { calculateTooltipPosition, getElementBounds } from './TutorialOverlay.geometry';
import type { TutorialOverlayProps } from './TutorialOverlay.types';

// Tracks the highlighted element's box, re-measuring on resize and scroll. Scroll
// is captured (third argument true) so it fires for any scrolling ancestor, not
// just the window.
const useTargetBounds = ({
  active,
  target,
}: {
  active: boolean;
  target?: string;
}) => {
  const [targetBounds, setTargetBounds] = useState<globalThis.DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!active || !target) return;

    const updateBounds = () => {
      const bounds = getElementBounds(target);
      setTargetBounds(bounds);
      setIsVisible(Boolean(bounds));
    };

    updateBounds();

    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);

    return () => {
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [active, target]);

  return { targetBounds, isVisible };
};

// Places the tooltip against the measured target once both boxes are known.
const useTooltipPlacement = ({
  targetBounds,
  isVisible,
  preferredPosition,
}: {
  targetBounds: globalThis.DOMRect | null;
  isVisible: boolean;
  preferredPosition?: string;
}) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [actualPlacement, setActualPlacement] = useState<string>('bottom');

  useEffect(() => {
    if (!targetBounds || !tooltipRef.current || !isVisible) return;

    const { position, placement } = calculateTooltipPosition(
      targetBounds,
      tooltipRef.current.getBoundingClientRect(),
      preferredPosition || 'auto',
    );

    setTooltipPosition(position);
    setActualPlacement(placement);
  }, [targetBounds, isVisible, preferredPosition]);

  return { tooltipRef, tooltipPosition, actualPlacement };
};

// Arrow keys step through the tour, Escape skips it.
const useTutorialKeyboard = ({
  enabled,
  onNext,
  onPrev,
  onSkip,
}: {
  enabled: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyPress = (e: globalThis.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          onPrev();
          break;
        case 'ArrowRight':
          onNext();
          break;
        case 'Escape':
          onSkip();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [enabled, onNext, onPrev, onSkip]);
};

export const useTutorialOverlay = ({
  steps,
  initialStep,
  active,
  allowKeyboardNavigation,
  onComplete,
  onSkip,
  onStepComplete,
}: {
  steps: TutorialOverlayProps['steps'];
  initialStep: number;
  active: boolean;
  allowKeyboardNavigation: boolean;
  onComplete?: () => void;
  onSkip?: () => void;
  onStepComplete?: (stepId: string) => void;
}) => {
  const [currentStep, setCurrentStep] = useState(initialStep);

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const { targetBounds, isVisible } = useTargetBounds({
    active,
    target: currentStepData?.target,
  });

  const { tooltipRef, tooltipPosition, actualPlacement } = useTooltipPlacement({
    targetBounds,
    isVisible,
    preferredPosition: currentStepData?.position,
  });

  const handleNext = useCallback(() => {
    const currentStepId = steps[currentStep]?.id;
    if (currentStepId) onStepComplete?.(currentStepId);

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      return;
    }

    onComplete?.();
  }, [currentStep, steps, onComplete, onStepComplete]);

  const handlePrev = useCallback(() => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    onSkip?.();
  }, [onSkip]);

  const handleRestart = useCallback(() => {
    setCurrentStep(0);
  }, []);

  useTutorialKeyboard({
    enabled: allowKeyboardNavigation && active,
    onNext: handleNext,
    onPrev: handlePrev,
    onSkip: handleSkip,
  });

  return {
    currentStep,
    currentStepData,
    isLastStep,
    isVisible,
    targetBounds,
    tooltipRef,
    tooltipPosition,
    actualPlacement,
    progress: ((currentStep + 1) / steps.length) * 100,
    handleNext,
    handlePrev,
    handleSkip,
    handleRestart,
  };
};
