import Box from '@mui/material/Box';
import type { CSSObject, Theme } from '@mui/material/styles';
import { styled } from '@mui/material/styles';
import React, { forwardRef, useCallback } from 'react';

import type { StepColors } from './WorkflowStep.helpers';
import { indicatorSizeFor, stepColors, stepPalette } from './WorkflowStep.helpers';
import type {
  StepConnectorProps,
  StepContentProps,
  StepIndicatorProps,
  WorkflowStepProps,
} from './WorkflowStep.types';

// `outlined` shows the surface through a coloured rim; the other three fill it and
// differ only in what border they keep.
const indicatorVariantStyles = (
  theme: Theme,
  variant: WorkflowStepProps['variant'],
  { backgroundColor, borderColor, textColor }: StepColors,
): CSSObject => {
  if (variant === 'outlined') {
    return {
      border: `2px solid ${borderColor}`,
      backgroundColor: theme.palette.background.paper,
    };
  }

  const filled = { backgroundColor, color: textColor };

  switch (variant) {
    case 'filled':
      return filled;
    case 'minimal':
      return { ...filled, border: 'none' };
    case 'default':
      return { ...filled, border: `1px solid ${borderColor}` };
    default:
      return {};
  }
};

const StepItem = styled(Box, {
  shouldForwardProp: (prop) => !['orientation', 'isLast'].includes(prop as string),
})<{
  orientation: WorkflowStepProps['orientation'];
  isLast: boolean;
}>(({ orientation, isLast }) => ({
  display: 'flex',
  flexDirection: orientation === 'vertical' ? 'column' : 'row',
  alignItems: orientation === 'vertical' ? 'flex-start' : 'center',
  flex: orientation === 'horizontal' && !isLast ? 1 : 'none',
  position: 'relative',
  minWidth: 0, // Allow content to shrink
}));

const StepIndicator = styled(Box, {
  shouldForwardProp: (prop) => !['size', 'variant', 'color', 'isActive', 'isCompleted', 'isError', 'interactive', 'disabled'].includes(prop as string),
})<{
  size: WorkflowStepProps['size'];
  variant: WorkflowStepProps['variant'];
  color: WorkflowStepProps['color'];
  isActive: boolean;
  isCompleted: boolean;
  isError: boolean;
  interactive: boolean;
  animated: boolean;
  disabled: boolean;
}>(({ theme, size, variant, color, isActive, isCompleted, isError, interactive, animated, disabled }) => {
  const indicatorSize = indicatorSizeFor(size);
  const palette = stepPalette(theme, color);
  const { backgroundColor, borderColor, textColor } = stepColors(theme, palette, {
    isActive,
    isCompleted,
    isError,
    variant,
  });

  return {
    width: indicatorSize,
    height: indicatorSize,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: theme.typography.caption.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    cursor: interactive && !disabled ? 'pointer' : 'default',
    transition: animated
      ? theme.transitions.create(['background-color', 'border-color', 'transform'], {
          duration: theme.transitions.duration.short,
        })
      : 'none',
    flexShrink: 0,

    ...indicatorVariantStyles(theme, variant, { backgroundColor, borderColor, textColor }),

    // Interactive states
    ...(interactive && !disabled && {
      '&:hover': {
        transform: 'scale(1.1)',
        boxShadow: theme.shadows[2],
      },
      '&:focus-visible': {
        outline: `2px solid ${palette.main}`,
        outlineOffset: '2px',
      },
    }),

    // Disabled state
    ...(disabled && {
      opacity: 0.5,
      cursor: 'not-allowed',
    }),
  };
});

const StepContent = styled(Box, {
  shouldForwardProp: (prop) => !['orientation', 'interactive', 'disabled'].includes(prop as string),
})<{
  orientation: WorkflowStepProps['orientation'];
  interactive: boolean;
  disabled: boolean;
}>(({ theme, orientation, interactive, disabled }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: orientation === 'vertical' ? 'flex-start' : 'center',
  textAlign: orientation === 'vertical' ? 'left' : 'center',
  marginTop: orientation === 'vertical' ? theme.spacing(1) : theme.spacing(0.5),
  marginLeft: orientation === 'horizontal' ? theme.spacing(1) : 0,
  cursor: interactive && !disabled ? 'pointer' : 'default',
  minWidth: 0,
  flex: 1,

  '& .step-title': {
    fontSize: theme.typography.body2.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.palette.text.primary,
    marginBottom: theme.spacing(0.5),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },

  '& .step-description': {
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },

  ...(disabled && {
    opacity: 0.5,
  }),
}));

const StepConnector = styled(Box, {
  shouldForwardProp: (prop) => !['orientation', 'isCompleted', 'color', 'variant'].includes(prop as string),
})<{
  orientation: WorkflowStepProps['orientation'];
  isCompleted: boolean;
  color: WorkflowStepProps['color'];
  variant: WorkflowStepProps['variant'];
}>(({ theme, orientation, isCompleted, color, variant }) => {
  const colorKey = color || 'primary';
  const colorValue = colorKey === 'neutral' 
    ? { main: theme.palette.grey[600] }
    : theme.palette[colorKey as 'primary' | 'secondary' | 'success' | 'warning' | 'error'];
  const connectorColor = isCompleted ? colorValue.main : theme.palette.grey[300];

  return {
    flex: 1,
    position: 'relative',
    
    ...(orientation === 'horizontal' && {
      height: '2px',
      backgroundColor: connectorColor,
      margin: `0 ${theme.spacing(1)}`,
      minWidth: theme.spacing(2),
    }),
    
    ...(orientation === 'vertical' && {
      width: '2px',
      backgroundColor: connectorColor,
      minHeight: theme.spacing(3),
      marginLeft: theme.spacing(2),
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      top: '100%',
    }),

    transition: theme.transitions.create('background-color', {
      duration: theme.transitions.duration.short,
    }),

    ...(variant === 'minimal' && {
      opacity: 0.6,
    }),
  };
});

/**
 * Individual step indicator component
 */
const StepIndicatorComponent = forwardRef<HTMLDivElement, StepIndicatorProps>(({
  step,
  index,
  isActive,
  isCompleted,
  isError,
  variant,
  color,
  size,
  showNumbers,
  showIcons,
  completedIcon,
  errorIcon,
  interactive,
  animated,
  disabled,
  onClick,
  'data-testid': dataTestId,
}, ref) => {
  const handleClick = useCallback(() => {
    if (interactive && !disabled && onClick) {
      onClick(index, step);
    }
  }, [interactive, disabled, onClick, index, step]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (interactive && !disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (onClick) {
        onClick(index, step);
      }
    }
  }, [interactive, disabled, onClick, index, step]);

  const renderIndicatorContent = () => {
    if (isError && errorIcon) {
      return errorIcon;
    }
    if (isCompleted && completedIcon) {
      return completedIcon;
    }
    if (showIcons && step.icon) {
      return step.icon;
    }
    if (showNumbers) {
      return index + 1;
    }
    return null;
  };

  return (
    <StepIndicator
      ref={ref}
      size={size}
      variant={variant}
      color={color}
      isActive={isActive}
      isCompleted={isCompleted}
      isError={isError}
      interactive={interactive}
      animated={animated}
      disabled={Boolean(disabled || step.disabled)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive && !disabled && !step.disabled ? 0 : -1}
      aria-label={`Step ${index + 1}: ${step.title}`}
      aria-current={isActive ? 'step' : undefined}
      data-testid={dataTestId}
    >
      {renderIndicatorContent()}
    </StepIndicator>
  );
});

StepIndicatorComponent.displayName = 'StepIndicator';

/**
 * Step connector component
 */
const StepConnectorComponent = forwardRef<HTMLDivElement, StepConnectorProps>(({
  isCompleted,
  orientation,
  variant,
  color,
  'data-testid': dataTestId,
}, ref) => (
  <StepConnector
    ref={ref}
    orientation={orientation}
    isCompleted={isCompleted}
    color={color}
    variant={variant}
    data-testid={dataTestId}
  />
));

StepConnectorComponent.displayName = 'StepConnector';

/**
 * Step content component
 */
const StepContentComponent = forwardRef<HTMLDivElement, StepContentProps>(({
  step,
  index,
  orientation,
  interactive,
  disabled,
  onClick,
  'data-testid': dataTestId,
}, ref) => {
  const handleClick = useCallback(() => {
    if (interactive && !disabled && onClick) {
      onClick(index, step);
    }
  }, [interactive, disabled, onClick, index, step]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (interactive && !disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (onClick) {
        onClick(index, step);
      }
    }
  }, [interactive, disabled, onClick, index, step]);

  return (
    <StepContent
      ref={ref}
      orientation={orientation}
      interactive={interactive}
      disabled={Boolean(disabled || step.disabled)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive && !disabled && !step.disabled ? 0 : -1}
      data-testid={dataTestId}
    >
      <div className="step-title">{step.title}</div>
      {step.description && (
        <div className="step-description">{step.description}</div>
      )}
    </StepContent>
  );
});

StepContentComponent.displayName = 'StepContent';

/**
 * A plain wrapper around the styled row. Exporting the styled component itself
 * trips TS2742 — its inferred type names a pnpm-internal @mui/system path.
 */
export const StepItemRow: React.FC<{
  orientation: WorkflowStepProps['orientation'];
  isLast: boolean;
  children: React.ReactNode;
}> = ({ orientation, isLast, children }) => (
  <StepItem orientation={orientation} isLast={isLast}>
    {children}
  </StepItem>
);

export { StepConnectorComponent, StepContentComponent, StepIndicatorComponent };
