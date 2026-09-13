import Box from '@mui/material/Box/index.js';
import FormHelperText from '@mui/material/FormHelperText/index.js';
import MuiSwitch from '@mui/material/Switch/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { LABEL_GAP_UNITS, SWITCH_ICON_SIZES, TAP_TARGET_MIN } from './Switch.metrics';
import { onTrackInk, switchSx } from './Switch.styles';
import type { SwitchFlags } from './Switch.styles';
import type { SwitchProps } from './Switch.types';
import type { SizeValue } from '../../../tokens/vocabulary';

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
    gap: theme.spacing(stacked ? LABEL_GAP_UNITS.stacked : LABEL_GAP_UNITS.beside),
    width: '100%',
    ...(error && { '& .MuiTypography-root': { color: theme.palette.error.main } }),
  };
});

/**
 * A plain wrapper over the styled row. Exporting the styled component itself
 * needs a @mui/system reference tsc calls unportable (TS2742).
 */
const LabelContainer: React.FC<{
  labelPosition?: string;
  error?: boolean;
  children: React.ReactNode;
}> = ({ labelPosition, error, children }) => (
  <StyledLabelContainer labelPosition={labelPosition} error={error}>
    {children}
  </StyledLabelContainer>
);

export interface SwitchIconProps {
  icon: React.ReactNode;
  /** True when this icon is the one the current state should show. */
  shown: boolean;
  animated: boolean;
  size: string;
  side: 'on' | 'off';
  /** The ink for the ON icon, which sits on the brand-filled track (FUT-1924). */
  onInk: string;
}

/**
 * One of the two icons overlaid on the track. The on icon slides to the left
 * edge when checked and the off icon to the right when unchecked; they are
 * mirror images, so they share this component rather than being written twice.
 */
export const SwitchIcon: React.FC<SwitchIconProps> = ({
  icon,
  shown,
  animated,
  size,
  side,
  onInk,
}) => {
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
        color: isOn ? onInk : 'text.secondary',
        fontSize: SWITCH_ICON_SIZES[size as SizeValue] ?? SWITCH_ICON_SIZES.md,
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
  /** The id the label points at — always set, so the input always has one. */
  inputId: string;
  /** The caller's own `inputProps`, merged rather than spread over (FUT-1905). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  /** The description's id, appended to whatever the caller described it by. */
  describedBy?: string;
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
  inputId,
  inputProps,
  describedBy,
  rest,
  ...flags
}) => {
  const props = rest as Record<string, unknown> & { disabled?: boolean };
  const theme = useTheme();
  const onInk = onTrackInk(theme, flags);

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <StyledSwitch
        ref={switchRef}
        {...flags}
        checked={checked}
        onChange={onChange}
        disabled={Boolean(flags.loading) || props.disabled}
        {...props}
        /*
          AFTER `props`, not before it (FUT-1905). `inputProps` used to be
          written first and `{...props}` spread over it, so a caller passing
          `inputProps` of its own silently replaced the whole object — losing
          the `data-testid` every spec finds this control by, and now the `id`
          the label points at. The caller's keys are merged INTO it instead,
          and the two the component owns are stated last.
        */
        inputProps={
          {
            'aria-label': props['aria-label'],
            ...inputProps,
            id: inputId,
            'aria-describedby': describedBy,
            'data-testid': dataTestId || 'switch',
          } as React.InputHTMLAttributes<HTMLInputElement>
        }
      />

      {onIcon && (
        <SwitchIcon
          icon={onIcon}
          shown={Boolean(checked)}
          animated={animated}
          size={size}
          side="on"
          onInk={onInk}
        />
      )}
      {offIcon && (
        <SwitchIcon
          icon={offIcon}
          shown={!checked}
          animated={animated}
          size={size}
          side="off"
          onInk={onInk}
        />
      )}
    </Box>
  );
};

/**
 * The helper line, which is where a validation message lands — so it is
 * `aria-describedby`'d like the description (FUT-1905).
 *
 * It carried no `id` and nothing pointed at it, which means an `error` state
 * announced as "checkbox, checked" and nothing else: the one sentence saying
 * WHY was on screen and outside the accessibility tree.
 */
export const SwitchHelper: React.FC<{
  helperText?: React.ReactNode;
  error?: boolean;
  dataTestId?: string;
  id?: string;
}> = ({ helperText, error, dataTestId, id }) =>
  helperText ? (
    <FormHelperText
      id={id}
      error={error}
      sx={{ mt: 1 }}
      data-testid={dataTestId ? `${dataTestId}-helper` : 'switch-helper'}
    >
      {helperText}
    </FormHelperText>
  ) : null;

/**
 * The label, WIRED to the input it names (FUT-1905).
 *
 * It used to be a `<p>` rendered as the control's sibling, with no `for`, no
 * `id` on the input and no `aria-labelledby` — so a labelled `Switch` announced
 * as "checkbox, checked" with no name, and clicking the words did nothing. Every
 * `Switch` in a consumer app was affected, not one call site, and the workaround
 * each had to write was a hand-typed `aria-label` duplicating the text already
 * on screen.
 *
 * A real `<label for>` fixes the name and the pointer in the same stroke, and it
 * is also the answer to the TAP TARGET: no size in `SWITCH_SIZES` clears the
 * 40px floor (`xl` is 34px tall), so the control cannot be made big enough by
 * passing a bigger `size` — instead the label becomes the target, which is how
 * this is normally solved. Hence `display: flex` and `TAP_TARGET_MIN`: the
 * label fills its half of the row and is never shorter than the floor.
 *
 * The DESCRIPTION stays outside the label and is pointed at by
 * `aria-describedby` instead: inside it, a two-line explanation would be read
 * out as part of the control's name.
 */
const SwitchLabel: React.FC<{
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: boolean;
  dataTestId?: string;
  /** The input's id. Omitted only where there is no input to point at. */
  htmlFor?: string;
  descriptionId?: string;
}> = ({ label, description, error, dataTestId, htmlFor, descriptionId }) => (
  <Box sx={{ flex: 1, minWidth: 0 }}>
    <Typography
      component="label"
      htmlFor={htmlFor}
      variant="body2"
      fontWeight={500}
      color={error ? 'error.main' : 'text.primary'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        // The floor applies to the row the label shares with the control. A
        // description already makes the row taller than 40px, so forcing it
        // there would only add blank space.
        ...(description ? {} : { minHeight: TAP_TARGET_MIN }),
        ...(htmlFor ? { cursor: 'pointer' } : {}),
      }}
      data-testid={dataTestId ? `${dataTestId}-label` : 'switch-label'}
    >
      {label}
    </Typography>
    {description && (
      <Typography
        id={descriptionId}
        variant="caption"
        color={error ? 'error.main' : 'text.secondary'}
        sx={{ display: 'block', mt: 0.5 }}
      >
        {description}
      </Typography>
    )}
  </Box>
);

/**
 * The control and its label in one row, or the control alone.
 *
 * Lives here rather than inline in `Switch.tsx` because the two branches only
 * differ in what surrounds the control — and the component that assembles them
 * was long enough that the wiring got hard to see between them.
 */
export const SwitchRow: React.FC<{
  label?: React.ReactNode;
  description?: React.ReactNode;
  labelPosition?: string;
  error?: boolean;
  dataTestId?: string;
  htmlFor: string;
  descriptionId?: string;
  control: React.ReactNode;
}> = ({
  label,
  description,
  labelPosition,
  error,
  dataTestId,
  htmlFor,
  descriptionId,
  control,
}) => {
  if (!label) return <>{control}</>;

  return (
    <LabelContainer labelPosition={labelPosition} error={error}>
      {labelPosition === 'start' && control}

      <SwitchLabel
        label={label}
        description={description}
        error={error}
        dataTestId={dataTestId}
        htmlFor={htmlFor}
        descriptionId={descriptionId}
      />

      {labelPosition !== 'start' && control}
    </LabelContainer>
  );
};
