import React from 'react';

import {
  StepConnectorComponent,
  StepContentComponent,
  StepIndicatorComponent,
  StepItemRow,
} from './WorkflowStep.parts';
import type { WorkflowStepItem, WorkflowStepProps } from './WorkflowStep.types';

interface StepRowProps {
  step: WorkflowStepItem;
  index: number;
  isLast: boolean;
  orientation: NonNullable<WorkflowStepProps['orientation']>;
  variant: NonNullable<WorkflowStepProps['variant']>;
  color: NonNullable<WorkflowStepProps['color']>;
  size: NonNullable<WorkflowStepProps['size']>;
  showNumbers: boolean;
  showIcons: boolean;
  showProgress: boolean;
  completedIcon?: React.ReactNode;
  errorIcon?: React.ReactNode;
  interactive: boolean;
  animated: boolean;
  disabled: boolean;
  onClick: (index: number, step: WorkflowStepItem) => void;
  dataTestId?: string;
}

/** One row of the workflow: its indicator, its text, and the rule leading to the next. */
export const StepRow: React.FC<StepRowProps> = ({
  step,
  index,
  isLast,
  orientation,
  variant,
  color,
  size,
  showNumbers,
  showIcons,
  showProgress,
  completedIcon,
  errorIcon,
  interactive,
  animated,
  disabled,
  onClick,
  dataTestId,
}) => {
  const isCompleted = step.status === 'completed';

  return (
    <StepItemRow orientation={orientation} isLast={isLast}>
      <StepIndicatorComponent
        step={step}
        index={index}
        isActive={step.status === 'current'}
        isCompleted={isCompleted}
        isError={step.status === 'error'}
        variant={variant}
        color={color}
        size={size}
        showNumbers={showNumbers}
        showIcons={showIcons}
        completedIcon={completedIcon}
        errorIcon={errorIcon}
        interactive={interactive}
        animated={animated}
        disabled={disabled}
        onClick={onClick}
        data-testid={`${dataTestId}-indicator-${index}`}
      />

      <StepContentComponent
        step={step}
        index={index}
        orientation={orientation}
        interactive={interactive}
        disabled={disabled}
        onClick={onClick}
        data-testid={`${dataTestId}-content-${index}`}
      />

      {showProgress && !isLast && (
        <StepConnectorComponent
          isCompleted={isCompleted}
          orientation={orientation}
          variant={variant}
          color={color}
          data-testid={`${dataTestId}-connector-${index}`}
        />
      )}
    </StepItemRow>
  );
};
