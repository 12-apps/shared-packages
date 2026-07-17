import { CheckCircle } from '@mui/icons-material';
import {
  Box,
  Button,
  styled,
  Typography,
} from '@mui/material';
import React from 'react';

import type { Step, StepItemProps, StepperProps } from './Stepper.types';

const StepperRoot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'orientation',
})<{ orientation: 'horizontal' | 'vertical'; component?: React.ElementType }>(({ orientation }) => ({
  display: 'flex',
  flexDirection: orientation === 'horizontal' ? 'row' : 'column',
  // Use flex-start to align all step circles at the same vertical position
  alignItems: 'flex-start',
}));

const StepItem = styled(Box, {
  shouldForwardProp: (prop) => !['orientation', 'isLast'].includes(prop as string),
})<{ orientation: 'horizontal' | 'vertical'; isLast: boolean }>(({ orientation, isLast }) => ({
  display: 'flex',
  // For horizontal: row layout so connector appears beside step content
  // For vertical: column layout so connector appears below step content
  flexDirection: orientation === 'horizontal' ? 'row' : 'column',
  // For horizontal: flex-start to keep circles aligned at top
  // For vertical: center to align connector with centered circle
  alignItems: orientation === 'horizontal' ? 'flex-start' : 'center',
  flex: orientation === 'horizontal' && !isLast ? 1 : 'none',
  position: 'relative',
  // For vertical: ensure consistent width for proper centering
  ...(orientation === 'vertical' && {
    width: '100%',
  }),
}));

/** Circle diameter per size. */
const CIRCLE_SIZE = { sm: 32, md: 48 } as const;

const StepButton = styled(Button, {
  shouldForwardProp: (prop) =>
    !['isActive', 'isCompleted', 'clickable', 'stepSize'].includes(prop as string),
})<{ isActive: boolean; isCompleted: boolean; clickable: boolean; stepSize: 'sm' | 'md' }>(
  ({ theme, isActive, isCompleted, clickable, stepSize }) => ({
    minWidth: CIRCLE_SIZE[stepSize],
    width: CIRCLE_SIZE[stepSize],
    height: CIRCLE_SIZE[stepSize],
    borderRadius: '50%',
    padding: 0,
    backgroundColor: isCompleted
      ? theme.palette.primary.main
      : isActive
      ? theme.palette.primary.main
      : theme.palette.grey[300],
    color: isCompleted || isActive ? theme.palette.primary.contrastText : theme.palette.text.primary,
    cursor: clickable ? 'pointer' : 'default',
    pointerEvents: clickable ? 'auto' : 'none',
    transition: theme.transitions.create(['background-color', 'transform'], {
      duration: theme.transitions.duration.short,
    }),
    '&:hover': clickable
      ? {
          backgroundColor: isCompleted
            ? theme.palette.primary.dark
            : isActive
            ? theme.palette.primary.dark
            : theme.palette.grey[400],
          transform: 'scale(1.05)',
        }
      : {},
    '&:disabled': {
      backgroundColor: theme.palette.grey[300],
      color: theme.palette.text.disabled,
    },
  }),
);

const StepConnector = styled(Box, {
  shouldForwardProp: (prop) =>
    !['orientation', 'isCompleted', 'size'].includes(prop as string),
})<{ orientation: 'horizontal' | 'vertical'; isCompleted: boolean; size: 'sm' | 'md' }>(
  ({ theme, orientation, isCompleted, size }) => ({
    backgroundColor: isCompleted ? theme.palette.primary.main : theme.palette.grey[300],
    transition: theme.transitions.create('background-color', {
      duration: theme.transitions.duration.short,
    }),
    ...(orientation === 'horizontal'
      ? {
          flex: 1,
          height: 2,
          // Vertically centered on the circle (circle/2 - 1 for the 2px line).
          marginTop: CIRCLE_SIZE[size] / 2 - 1,
          marginLeft: 8,
          marginRight: 8,
          minWidth: 24,
        }
      : {
          width: 2,
          height: 32,
          marginTop: 8,
          marginBottom: 8,
          // Use margin auto to center horizontally
          marginLeft: 'auto',
          marginRight: 'auto',
        }),
  }),
);

const StepLabel = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'orientation',
})<{ orientation: 'horizontal' | 'vertical' }>(({ orientation }) => ({
  textAlign: 'center',
  marginTop: orientation === 'horizontal' ? 8 : 0,
}));

type StepSize = 'sm' | 'md';
type LabelVariant = 'caption' | 'body2';

/** Space-joined state classes for a step (active / completed / optional). */
function stepClasses(isActive: boolean, isCompleted: boolean, optional?: boolean): string {
  return [
    isActive && 'stepper-step-active',
    isCompleted && 'stepper-step-completed',
    optional && 'stepper-step-optional',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The circle content-column width per orientation/size. */
function contentSx(orientation: 'horizontal' | 'vertical', size: StepSize) {
  return orientation === 'horizontal'
    ? { minWidth: size === 'sm' ? 56 : 80, maxWidth: 150, flex: '0 1 auto' }
    : { flexShrink: 0 };
}

interface StepPartProps {
  step: Step;
  index: number;
  isActive: boolean;
  size: StepSize;
  labelVariant: LabelVariant;
}

/** The step circle: a check when completed, otherwise the 1-based index. */
const StepCircle: React.FC<
  StepPartProps & { isCompleted: boolean; isClickable: boolean; onClick: () => void }
> = ({ step, index, isActive, isCompleted, isClickable, size, labelVariant, onClick }) => {
  const state = isCompleted ? ' (completed)' : isActive ? ' (current)' : '';
  return (
    <StepButton
      isActive={isActive}
      isCompleted={isCompleted}
      clickable={isClickable}
      stepSize={size}
      onClick={onClick}
      disabled={step.disabled}
      aria-current={isActive ? 'step' : undefined}
      aria-label={`Step ${index + 1}: ${step.label}${step.optional ? ' (optional)' : ''}${state}`}
      data-testid={`stepper-step-icon-${index}`}
    >
      {isCompleted ? (
        <CheckCircle sx={{ fontSize: size === 'sm' ? 18 : 24 }} />
      ) : (
        <Typography variant={labelVariant} fontWeight="bold">
          {index + 1}
        </Typography>
      )}
    </StepButton>
  );
};

/** The step label block: title, optional marker, and description. */
const StepLabelBlock: React.FC<StepPartProps & { orientation: 'horizontal' | 'vertical' }> = ({
  step,
  index,
  isActive,
  orientation,
  size,
  labelVariant,
}) => (
  <StepLabel
    orientation={orientation}
    data-testid={`stepper-step-label-${index}`}
    sx={size === 'sm' && orientation === 'horizontal' ? { mt: '2px' } : undefined}
  >
    <Typography
      variant={labelVariant}
      fontWeight={isActive ? 'bold' : 'normal'}
      color={isActive ? 'primary' : 'textPrimary'}
    >
      {step.label}
      {step.optional && (
        <Typography component="span" variant="caption" color="textSecondary" sx={{ ml: 1 }}>
          (optional)
        </Typography>
      )}
    </Typography>
    {step.description && (
      <Typography variant="caption" color="textSecondary" display="block">
        {step.description}
      </Typography>
    )}
  </StepLabel>
);

const StepperItem: React.FC<StepItemProps> = ({
  step,
  index,
  isActive,
  isCompleted,
  isLast,
  orientation,
  size,
  variant,
  clickable,
  onStepClick,
  renderConnector,
  nextStep,
}) => {
  const labelVariant: LabelVariant = size === 'sm' ? 'caption' : 'body2';
  const isClickable = Boolean(clickable) && !step.disabled && (variant === 'non-linear' || !isActive);
  const handleStepClick = () => {
    if (isClickable && onStepClick) onStepClick(step.id);
  };
  const connector =
    renderConnector && nextStep ? (
      renderConnector(step, nextStep, { completed: isCompleted, active: isActive })
    ) : (
      <StepConnector orientation={orientation} isCompleted={isCompleted} size={size} data-testid={`stepper-connector-${index}`} />
    );

  return (
    <StepItem
      orientation={orientation}
      isLast={isLast}
      role="listitem"
      data-testid={`stepper-step-${index}`}
      className={stepClasses(isActive, isCompleted, step.optional)}
    >
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        data-testid={`stepper-step-content-${index}`}
        sx={contentSx(orientation, size)}
      >
        <StepCircle
          step={step}
          index={index}
          isActive={isActive}
          isCompleted={isCompleted}
          isClickable={isClickable}
          size={size}
          labelVariant={labelVariant}
          onClick={handleStepClick}
        />
        <StepLabelBlock
          step={step}
          index={index}
          isActive={isActive}
          orientation={orientation}
          size={size}
          labelVariant={labelVariant}
        />
      </Box>
      {!isLast && connector}
    </StepItem>
  );
};

export const Stepper: React.FC<StepperProps> = ({
  steps,
  activeId,
  completed = new Set(),
  orientation = 'horizontal',
  size = 'md',
  variant = 'linear',
  onStepChange,
  clickable,
  renderConnector,
  className,
  'data-testid': dataTestId,
}) => {
  // Determine clickable behavior
  const isClickable = clickable ?? variant === 'non-linear';

  return (
    <StepperRoot
      component="ol"
      orientation={orientation}
      className={className}
      data-testid={dataTestId || 'stepper-container'}
      sx={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
      }}
    >
      {steps.map((step, index) => {
        const isActive = step.id === activeId;
        const isCompleted = completed.has(step.id);
        const isLast = index === steps.length - 1;
        const nextStep = !isLast ? steps[index + 1] : undefined;

        return (
          <StepperItem
            key={step.id}
            step={step}
            index={index}
            isActive={isActive}
            isCompleted={isCompleted}
            isLast={isLast}
            orientation={orientation}
            size={size}
            variant={variant}
            clickable={isClickable}
            onStepClick={onStepChange}
            renderConnector={renderConnector}
            nextStep={nextStep}
          />
        );
      })}
    </StepperRoot>
  );
};