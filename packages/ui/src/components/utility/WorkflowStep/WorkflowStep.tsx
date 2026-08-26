import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import React, { forwardRef, useCallback, useMemo } from 'react';

import { resolveWorkflowStepProps, withDerivedStatus } from './WorkflowStep.helpers';
import { StepRow } from './WorkflowStepRow';
import type { WorkflowStepItem, WorkflowStepProps } from './WorkflowStep.types';

// Styled Components
const StepContainer = styled(Box, {
  shouldForwardProp: (prop) => !['orientation', 'variant'].includes(prop as string),
})<{
  orientation: WorkflowStepProps['orientation'];
  variant: WorkflowStepProps['variant'];
}>(({ theme, orientation, variant }) => ({
  display: 'flex',
  flexDirection: orientation === 'vertical' ? 'column' : 'row',
  alignItems: orientation === 'vertical' ? 'flex-start' : 'center',
  gap: orientation === 'vertical' ? theme.spacing(2) : theme.spacing(1),
  width: '100%',
  position: 'relative',
  
  // Variant-specific styles
  ...(variant === 'minimal' && {
    gap: orientation === 'vertical' ? theme.spacing(1) : theme.spacing(0.5),
  }),
}));

/**
 * WorkflowStep component for displaying multi-step workflows with visual progression
 */
export const WorkflowStep = forwardRef<HTMLDivElement, WorkflowStepProps>((rawProps, ref) => {
  const {
    steps,
    currentStep,
    variant,
    orientation,
    color,
    size,
    showProgress,
    animated,
    interactive,
    showNumbers,
    showIcons,
    completedIcon,
    errorIcon,
    onStepClick,
    disabled,
    className,
    style,
    'data-testid': dataTestId,
    ...other
  } = resolveWorkflowStepProps(rawProps);
  const handleStepClick = useCallback((stepIndex: number, step: WorkflowStepItem) => {
    if (onStepClick && !disabled && !step.disabled) {
      onStepClick(stepIndex, step);
    }
  }, [onStepClick, disabled]);

  const stepsWithStatus = useMemo(
    () => withDerivedStatus(steps, currentStep),
    [steps, currentStep],
  );

  return (
    <StepContainer
      ref={ref}
      orientation={orientation}
      variant={variant}
      className={className}
      style={style}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length - 1}
      aria-valuenow={currentStep}
      aria-valuetext={`Step ${currentStep + 1} of ${steps.length}: ${steps[currentStep]?.title}`}
      data-testid={dataTestId}
      {...other}
    >
      {stepsWithStatus.map((step, index) => (
        <StepRow
          key={index}
          step={step}
          index={index}
          isLast={index === steps.length - 1}
          orientation={orientation}
          variant={variant}
          color={color}
          size={size}
          showNumbers={showNumbers}
          showIcons={showIcons}
          showProgress={showProgress}
          completedIcon={completedIcon}
          errorIcon={errorIcon}
          interactive={interactive}
          animated={animated}
          disabled={disabled}
          onClick={handleStepClick}
          dataTestId={dataTestId}
        />
      ))}
    </StepContainer>
  );
});

WorkflowStep.displayName = 'WorkflowStep';

export default WorkflowStep;