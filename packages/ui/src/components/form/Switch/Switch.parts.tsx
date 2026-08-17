import { Box, FormHelperText, Switch as MuiSwitch, Typography } from '@mui/material';
import { styled } from '@mui/material';
import React from 'react';

import { switchSx } from './Switch.styles';
import type { SwitchFlags } from './Switch.styles';
import type { SwitchProps } from './Switch.types';

const StyledSwitch = styled(MuiSwitch, {
  shouldForwardProp: (prop) =>
    ![
      'customVariant',
      'customColor',
      'customSize',
      'glow',
      'glass',
      'gradient',
      'trackWidth',
      'trackHeight',
      'onText',
      'offText',
      'loading',
      'ripple',
      'pulse',
    ].includes(prop as string),
})<SwitchFlags>(({ theme, ...flags }) => ({ ...switchSx(theme, flags) }));

/**
 * A top or bottom label stacks and aligns to the start; start/end sit the label
 * beside the control and centre it.
 */
const StyledLabelContainer = styled(Box, {
  shouldForwardProp: (prop) => !['labelPosition', 'error'].includes(prop as string),
})<{ labelPosition?: string; error?: boolean }>(({ theme, labelPosition, error }) => {
  const stacked = labelPosition === 'top' || labelPosition === 'bottom';

  return {
    display: 'flex',
    alignItems: stacked ? 'flex-start' : 'center',
    flexDirection:
      labelPosition === 'top' ? 'column' : labelPosition === 'bottom' ? 'column-reverse' : 'row',
    gap: theme.spacing(stacked ? 1 : 2),
    width: '100%',
    ...(error && { '& .MuiTypography-root': { color: theme.palette.error.main } }),
  };
});

/**
 * A plain wrapper over the styled row. Exporting the styled component itself
 * needs a @mui/system reference tsc calls unportable (TS2742).
 */
export const LabelContainer: React.FC<{
  labelPosition?: string;
  error?: boolean;
  children: React.ReactNode;
}> = ({ labelPosition, error, children }) => (
  <StyledLabelContainer labelPosition={labelPosition} error={error}>
    {children}
  </StyledLabelContainer>
);

const ICON_SIZES: Record<string, number> = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 };

export interface SwitchIconProps {
  icon: React.ReactNode;
  /** True when this icon is the one the current state should show. */
  shown: boolean;
  animated: boolean;
  size: string;
  side: 'on' | 'off';
}

/**
 * One of the two icons overlaid on the track. The on icon slides to the left
 * edge when checked and the off icon to the right when unchecked; they are
 * mirror images, so they share this component rather than being written twice.
 */
export const SwitchIcon: React.FC<SwitchIconProps> = ({ icon, shown, animated, size, side }) => {
  const isOn = side === 'on';
  const translate = isOn ? 'translate(-50%, -50%)' : 'translate(50%, -50%)';

  return (
    <Box
      sx={{
        position: 'absolute',
        top: '50%',
        ...(isOn ? { left: shown ? 4 : '50%' } : { right: shown ? 4 : '50%' }),
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: shown ? 1 : 0,
        transform: `${translate} scale(${shown && animated ? 1 : 0.8})`,
        pointerEvents: 'none',
        zIndex: 2,
        color: isOn ? '#fff' : 'text.secondary',
        fontSize: ICON_SIZES[size] ?? ICON_SIZES.md,
      }}
    >
      {icon}
    </Box>
  );
};

export interface SwitchControlProps extends SwitchFlags {
  checked?: boolean;
  onChange?: SwitchProps['onChange'];
  onIcon?: React.ReactNode;
  offIcon?: React.ReactNode;
  animated: boolean;
  size: string;
  dataTestId?: string;
  switchRef?: React.Ref<HTMLButtonElement>;
  rest: Record<string, unknown>;
}

/** The control itself: the track, and the two icons that may sit over it. */
export const SwitchControl: React.FC<SwitchControlProps> = ({
  checked,
  onChange,
  onIcon,
  offIcon,
  animated,
  size,
  dataTestId,
  switchRef,
  rest,
  ...flags
}) => {
  const props = rest as Record<string, unknown> & {
    disabled?: boolean;
    inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  };

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <StyledSwitch
        ref={switchRef}
        {...flags}
        checked={checked}
        onChange={onChange}
        disabled={Boolean(flags.loading) || props.disabled}
        inputProps={
          {
            'aria-label': props['aria-label'],
            'aria-describedby': props['aria-describedby'],
            ...props.inputProps,
            'data-testid': dataTestId || 'switch',
          } as React.InputHTMLAttributes<HTMLInputElement>
        }
        {...props}
      />

      {onIcon && (
        <SwitchIcon
          icon={onIcon}
          shown={Boolean(checked)}
          animated={animated}
          size={size}
          side="on"
        />
      )}
      {offIcon && (
        <SwitchIcon
          icon={offIcon}
          shown={!checked}
          animated={animated}
          size={size}
          side="off"
        />
      )}
    </Box>
  );
};

export const SwitchHelper: React.FC<{
  helperText?: React.ReactNode;
  error?: boolean;
  dataTestId?: string;
}> = ({ helperText, error, dataTestId }) =>
  helperText ? (
    <FormHelperText
      error={error}
      sx={{ mt: 1 }}
      data-testid={dataTestId ? `${dataTestId}-helper` : 'switch-helper'}
    >
      {helperText}
    </FormHelperText>
  ) : null;

export const SwitchLabel: React.FC<{
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: boolean;
  dataTestId?: string;
}> = ({ label, description, error, dataTestId }) => (
  <Box sx={{ flex: 1 }}>
    <Typography
      variant="body2"
      fontWeight={500}
      color={error ? 'error.main' : 'text.primary'}
      data-testid={dataTestId ? `${dataTestId}-label` : 'switch-label'}
    >
      {label}
    </Typography>
    {description && (
      <Typography
        variant="caption"
        color={error ? 'error.main' : 'text.secondary'}
        sx={{ display: 'block', mt: 0.5 }}
      >
        {description}
      </Typography>
    )}
  </Box>
);
