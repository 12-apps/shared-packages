import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import MuiRadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import React from 'react';

import {
  buttonRadioSx,
  formLabelSx,
  radioCardSx,
  segmentButtonSx,
  segmentContainerSx,
} from './RadioGroup.styles';
import type { SurfaceFlags } from './RadioGroup.styles';
import type { RadioOption, RadioGroupProps } from './RadioGroup.types';

const StyledFormLabel = styled(FormLabel, {
  shouldForwardProp: (prop) => !['glass', 'error'].includes(prop as string),
})<{ glass?: boolean; error?: boolean }>(({ theme, glass, error }) => ({
  ...formLabelSx(theme, glass, error),
}));

const StyledRadioCard = styled(Card, {
  shouldForwardProp: (prop) =>
    !['selected', 'customColor', 'glass', 'gradient', 'glow', 'customSize', 'animated'].includes(
      prop as string,
    ),
})<SurfaceFlags>(({ theme, ...flags }) => ({ ...radioCardSx(theme, flags) }));

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
  option: RadioOption;
  index: number;
  isSelected: boolean;
  color: string;
  showDescriptions: boolean;
  dataTestId?: string;
}

/** A card's contents: the icon, the label, and the optional description under it. */
export const CardBody: React.FC<CardBodyProps> = ({
  option,
  index,
  isSelected,
  color,
  showDescriptions,
  dataTestId,
}) => (
  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
      {option.icon && (
        <Box sx={{ mt: 0.5, color: isSelected ? `${color}.main` : 'text.secondary' }}>
          {option.icon}
        </Box>
      )}
      <Box sx={{ flex: 1 }}>
        <Typography
          variant="subtitle1"
          fontWeight={600}
          color={isSelected ? `${color}.main` : 'text.primary'}
          data-testid={testId(dataTestId, `label-${index}`)}
        >
          {option.label}
        </Typography>
        {option.description && showDescriptions && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {option.description}
          </Typography>
        )}
      </Box>
    </Box>
  </CardContent>
);

export { OptionLabel };

export const CardRadios: React.FC<VariantProps> = ({
  options, value, color, size, direction, showDescriptions, glass, gradient, glow, dataTestId, onSelect,
}) => (
  <Box
    sx={{ display: 'flex', flexDirection: direction, gap: 2 }}
    data-testid={testId(dataTestId, 'container')}
  >
    {options.map((option, index) => (
      <StyledRadioCard
        key={option.value}
        selected={value === option.value}
        customColor={color}
        glass={glass}
        gradient={gradient}
        glow={glow}
        customSize={size}
        animated
        data-testid={testId(dataTestId, `card-${index}`)}
        onClick={() => onSelect(option)}
      >
        <CardBody
          option={option}
          index={index}
          isSelected={value === option.value}
          color={color}
          showDescriptions={showDescriptions}
          dataTestId={dataTestId}
        />
      </StyledRadioCard>
    ))}
  </Box>
);

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
