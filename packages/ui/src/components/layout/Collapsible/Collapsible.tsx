import { Box, Collapse,useTheme } from '@mui/material';
import React, { useCallback,useEffect, useRef, useState } from 'react';

import {
  dimmedStyles,
  regionAttrs,
  transitionSettings,
  triggerStyles,
} from './Collapsible.helpers';
import type { CollapsibleContentProps,CollapsibleProps, CollapsibleTriggerProps } from './Collapsible.types';

/**
 * The smooth and spring variants animate an explicit pixel height, so the content
 * has to be measured after every render that could have changed it.
 */
const useMeasuredHeight = (
  open: boolean,
  maxHeight: number | undefined,
  children: React.ReactNode,
) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  const measureHeight = useCallback(() => {
    if (contentRef.current) {
      const scrollHeight = contentRef.current.scrollHeight;
      // Cap at maxHeight if provided
      setHeight(maxHeight ? Math.min(scrollHeight, maxHeight) : scrollHeight);
    }
  }, [maxHeight]);

  useEffect(() => {
    if (!open) {
      setHeight(0);
    } else if (contentRef.current) {
      measureHeight();
    }
  }, [open, measureHeight, children]);

  return { contentRef, height };
};

type VariantProps = Omit<CollapsibleProps, 'variant' | 'onToggle'> & {
  duration: number;
  disabled: boolean;
  keepMounted: boolean;
  transition: { duration: number; easing: string };
};

// Use MUI's built-in Collapse for the default variant.
const DefaultCollapsible: React.FC<VariantProps> = ({
  children,
  open,
  duration,
  disabled,
  keepMounted,
  maxHeight,
  sx,
  className,
  dataTestId,
  transition: _transition,
  easing: _easing,
  ...otherProps
}) => (
  <Collapse
    in={open && !disabled}
    timeout={disabled ? 0 : duration}
    sx={{
      ...dimmedStyles(disabled),
      ...(maxHeight && { maxHeight, overflow: 'hidden' }),
      ...sx,
    }}
    className={className}
    unmountOnExit={!keepMounted}
    {...regionAttrs({ open, disabled, dataTestId })}
    {...otherProps}
  >
    <Box>{children}</Box>
  </Collapse>
);

const AnimatedCollapsible: React.FC<VariantProps> = ({
  children,
  open,
  disabled,
  keepMounted,
  maxHeight,
  transition,
  sx,
  className,
  dataTestId,
  duration: _duration,
  easing: _easing,
  ...otherProps
}) => {
  const { contentRef, height } = useMeasuredHeight(open, maxHeight, children);

  return (
    <Box
      component="div"
      sx={{
        overflow: 'hidden',
        height: open && !disabled ? height : 0,
        transition: disabled ? 'none' : `height ${transition.duration}ms ${transition.easing}`,
        willChange: disabled ? 'auto' : 'height',
        ...dimmedStyles(disabled),
        ...sx,
      }}
      className={className}
      {...regionAttrs({ open, disabled, dataTestId })}
      {...otherProps}
    >
      <Box ref={contentRef}>{(keepMounted || (open && !disabled)) && children}</Box>
    </Box>
  );
};

export const Collapsible: React.FC<CollapsibleProps> = ({
  variant = 'default',
  duration = 300,
  easing,
  onToggle,
  disabled = false,
  keepMounted = false,
  ...rest
}) => {
  const theme = useTheme();
  const { open } = rest;

  // Trigger onToggle callback when open state changes
  useEffect(() => {
    if (onToggle && !disabled) {
      onToggle(open);
    }
  }, [open, onToggle, disabled]);

  const variantProps: VariantProps = {
    ...rest,
    duration,
    easing,
    disabled,
    keepMounted,
    transition: transitionSettings(theme, variant, duration, easing),
  };

  return variant === 'default' ? (
    <DefaultCollapsible {...variantProps} />
  ) : (
    <AnimatedCollapsible {...variantProps} />
  );
};

export const CollapsibleTrigger: React.FC<CollapsibleTriggerProps> = ({
  children,
  onClick,
  disabled = false,
  expanded = false,
  className,
  dataTestId,
  ...otherProps
}) => {
  const theme = useTheme();

  return (
    <Box
      component="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={className}
      data-testid={dataTestId}
      aria-expanded={expanded}
      aria-disabled={disabled}
      role="button"
      tabIndex={disabled ? -1 : 0}
      data-state={expanded ? 'open' : 'closed'}
      sx={triggerStyles(theme, { disabled, expanded })}
      {...otherProps}
    >
      {children}
    </Box>
  );
};

export const CollapsibleContent: React.FC<CollapsibleContentProps> = ({
  children,
  className,
  ...otherProps
}) => {
  const theme = useTheme();

  return (
    <Box
      className={className}
      sx={{
        padding: theme.spacing(2),
      }}
      {...otherProps}
    >
      {children}
    </Box>
  );
};
