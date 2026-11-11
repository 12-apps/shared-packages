import Box from '@mui/material/Box/index.js';
import ButtonBase from '@mui/material/ButtonBase/index.js';
import CardContent from '@mui/material/CardContent/index.js';
import FormControlLabel from '@mui/material/FormControlLabel/index.js';
import FormLabel from '@mui/material/FormLabel/index.js';
import Radio from '@mui/material/Radio/index.js';
import MuiRadioGroup from '@mui/material/RadioGroup/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import {
  buttonRadioSx,
  formLabelSx,
  segmentButtonSx,
  segmentContainerSx,
} from './RadioGroup.styles';
import type { SurfaceFlags } from './RadioGroup.styles';
import type { RadioOption, RadioGroupProps } from './RadioGroup.types';
import { muiSize } from '../../../tokens/vocabulary';
import type { RadioProps } from '@mui/material/Radio/index.js';

const StyledFormLabel = styled(FormLabel, {
  shouldForwardProp: (prop) => !['glass', 'error'].includes(prop as string),
})<{ glass?: boolean; error?: boolean }>(({ theme, glass, error }) => ({
  ...formLabelSx(theme, glass, error),
}));

const StyledButtonRadio = styled(ButtonBase, {
  shouldForwardProp: (prop) =>
    !['selected', 'customColor', 'glass', 'gradient', 'customSize', 'animated'].includes(
      prop as string,
    ),
})<SurfaceFlags>(({ theme, ...flags }) => ({ ...buttonRadioSx(theme, flags) }));

const StyledSegmentContainer = styled(Box, {
  shouldForwardProp: (prop) => !['glass', 'customColor'].includes(prop as string),
})<{ glass?: boolean; customColor?: string }>(({ theme, glass, customColor }) => ({
  ...segmentContainerSx(theme, glass, customColor),
}));

const StyledSegmentButton = styled(ButtonBase, {
  shouldForwardProp: (prop) =>
    !['selected', 'customColor', 'customSize', 'animated'].includes(prop as string),
})<SurfaceFlags>(({ theme, ...flags }) => ({ ...segmentButtonSx(theme, flags) }));


export interface VariantProps {
  options: RadioOption[];
  value?: unknown;
  color: NonNullable<RadioGroupProps['color']>;
  size: NonNullable<RadioGroupProps['size']>;
  direction: NonNullable<RadioGroupProps['direction']>;
  showDescriptions: boolean;
  glass: boolean;
  gradient: boolean;
  glow: boolean;
  dataTestId?: string;
  onSelect: (option: RadioOption) => void;
  /** Only the default variant hands its ref and extra props to MUI's group. */
  groupRef?: React.Ref<HTMLDivElement>;
  onChange?: RadioGroupProps['onChange'];
  rest?: Record<string, unknown>;
  /** The group's label, which names the cards variant's `radiogroup`. */
  label?: string;
  /** The cards variant draws a radio in each card (FUT-4477). */
  indicator?: boolean;
}

/** `${dataTestId}-${suffix}`, or nothing when the caller supplied no id. */
export const testId = (base: string | undefined, suffix: string) =>
  base ? `${base}-${suffix}` : undefined;

/**
 * MUI's Radio has no `danger`; this component's palette calls the error colour
 * that, so the name is translated at the boundary.
 */
const muiRadioColor = (color: string) =>
  color === 'danger'
    ? 'error'
    : (color as 'primary' | 'secondary' | 'success' | 'warning' | 'error');

/** An option's icon beside its label, the run every variant but `cards` uses. */
const OptionLabel: React.FC<{ option: RadioOption; testIdValue?: string }> = ({
  option,
  testIdValue,
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid={testIdValue}>
    {option.icon}
    {option.label}
  </Box>
);

export const DefaultRadios: React.FC<VariantProps> = ({
  options,
  value,
  color,
  size,
  direction,
  showDescriptions,
  dataTestId,
  groupRef,
  onChange,
  rest,
}) => (
  <MuiRadioGroup
    ref={groupRef}
    value={value}
    onChange={onChange}
    {...rest}
    sx={{ flexDirection: direction, gap: 1 }}
    data-testid={testId(dataTestId, 'group')}
  >
    {options.map((option, index) => (
      <FormControlLabel
        key={option.value}
        value={option.value}
        disabled={option.disabled}
        data-testid={testId(dataTestId, `option-${index}`)}
        control={
          <Radio
            color={muiRadioColor(color)}
            // MUI's own `Radio` types `size` as `'small' | 'medium'` only, but its
            // glyph (`RadioButtonIcon`, an `SvgIcon`) reads whatever `size` it is
            // given as its own `fontSize` and draws it at that step regardless —
            // `'large'` already renders at 35px (`SvgIcon.js`'s own
            // `fontSize: pxToRem(35)` for that step), MUI's public type just never
            // advertised it. Confined to this one call site rather than a module
            // augmentation, which would widen every consumer's `Radio` type.
            size={muiSize(size) as RadioProps['size']}
            data-testid={testId(dataTestId, `radio-${index}`)}
          />
        }
        label={
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
            data-testid={testId(dataTestId, `label-${index}`)}
          >
            {option.icon}
            <Box>
              <Typography>{option.label}</Typography>
              {option.description && showDescriptions && (
                <Typography variant="caption" color="text.secondary">
                  {option.description}
                </Typography>
              )}
            </Box>
          </Box>
        }
      />
    ))}
  </MuiRadioGroup>
);

export interface CardBodyProps {
  /** A visible radio before the label, presentational: the card is the radio. */
  indicator?: boolean;
  /**
   * `xs`/`sm` cards: the card's own padding is the only padding, the gaps are
   * tighter and the label is body-sized, so four fit on a row in a form.
   */
  compact?: boolean;
  option: RadioOption;
  index: number;
  isSelected: boolean;
  color: string;
  showDescriptions: boolean;
  dataTestId?: string;
}

/** The compact (`xs`/`sm`) and roomy faces of a card's body. */
const BODY_LOOK = {
  compact: {
    content: { p: 0, '&:last-child': { pb: 0 } },
    gap: 1.5,
    label: 'body2',
    description: 'caption',
    descriptionGap: 0.25,
    // The caption at a plain line-height, not the letter-spaced 1.66.
    descriptionSx: { lineHeight: 1.35, letterSpacing: 0 },
  },
  roomy: { content: { p: 2, '&:last-child': { pb: 2 } }, gap: 2, label: 'subtitle1', description: 'body2', descriptionGap: 0.5, descriptionSx: {} },
} as const;

/** The presentational radio mark of `indicator`: the card itself is the radio. */
const CardIndicator: React.FC<{ checked: boolean; color: string }> = ({ checked, color }) => (
  <Radio
    checked={checked}
    tabIndex={-1}
    aria-hidden
    disableRipple
    color={color === 'neutral' ? 'default' : muiRadioColor(color)}
    size="small"
    sx={{ p: 0, mt: 0.25, pointerEvents: 'none' }}
    inputProps={{ 'aria-hidden': true, tabIndex: -1 }}
  />
);

/** A card's contents: the icon, the label, and the optional description under it. */
export const CardBody: React.FC<CardBodyProps> = ({
  option,
  index,
  isSelected,
  color,
  showDescriptions,
  dataTestId,
  indicator,
  compact,
}) => {
  const look = compact ? BODY_LOOK.compact : BODY_LOOK.roomy;
  const described = Boolean(option.description) && showDescriptions;
  return (
    <CardContent sx={look.content}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: look.gap }}>
        {indicator && <CardIndicator checked={isSelected} color={color} />}
        {option.icon && (
          <Box sx={{ mt: 0.5, color: isSelected ? `${color}.main` : 'text.secondary' }}>
            {option.icon}
          </Box>
        )}
        <Box sx={{ flex: 1 }}>
          <Typography
            variant={look.label}
            fontWeight={600}
            // Compact: the tint and edge say chosen; the name stays ink.
            color={isSelected && !compact ? `${color}.main` : 'text.primary'}
            data-testid={testId(dataTestId, `label-${index}`)}
          >
            {option.label}
          </Typography>
          {described && (
            <Typography variant={look.description} component="p" color="text.secondary" sx={{ mt: look.descriptionGap, ...look.descriptionSx }} data-description="">
              {option.description}
            </Typography>
          )}
        </Box>
      </Box>
    </CardContent>
  );
};

export { OptionLabel };

export const ButtonRadios: React.FC<VariantProps> = ({
  options, value, color, size, direction, glass, gradient, dataTestId, onSelect,
}) => (
  <Box
    sx={{ display: 'flex', flexDirection: direction, gap: 1, flexWrap: 'wrap' }}
    data-testid={testId(dataTestId, 'container')}
  >
    {options.map((option, index) => (
      <StyledButtonRadio
        key={option.value}
        selected={value === option.value}
        customColor={color}
        glass={glass}
        gradient={gradient}
        customSize={size}
        animated
        disabled={option.disabled}
        data-testid={testId(dataTestId, `button-${index}`)}
        onClick={() => onSelect(option)}
      >
        <OptionLabel option={option} testIdValue={testId(dataTestId, `label-${index}`)} />
      </StyledButtonRadio>
    ))}
  </Box>
);

export const SegmentRadios: React.FC<VariantProps> = ({
  options, value, color, size, glass, dataTestId, onSelect,
}) => (
  <StyledSegmentContainer
    glass={glass}
    customColor={color}
    data-testid={testId(dataTestId, 'container')}
  >
    {options.map((option, index) => (
      <StyledSegmentButton
        key={option.value}
        selected={value === option.value}
        customColor={color}
        customSize={size}
        animated
        disabled={option.disabled}
        data-testid={testId(dataTestId, `segment-${index}`)}
        onClick={() => onSelect(option)}
      >
        <OptionLabel option={option} testIdValue={testId(dataTestId, `label-${index}`)} />
      </StyledSegmentButton>
    ))}
  </StyledSegmentContainer>
);

/** The group's own label, which can carry the glass treatment independently. */
export const GroupLabel: React.FC<{
  glass?: boolean;
  error?: boolean;
  dataTestId?: string;
  children: React.ReactNode;
}> = ({ glass, error, dataTestId, children }) => (
  <StyledFormLabel glass={glass} error={error} data-testid={testId(dataTestId, 'label')}>
    {children}
  </StyledFormLabel>
);
