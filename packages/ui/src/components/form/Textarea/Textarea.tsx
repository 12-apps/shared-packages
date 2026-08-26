import Box from '@mui/material/Box/index.js';
import FormHelperText from '@mui/material/FormHelperText/index.js';
import InputLabel from '@mui/material/InputLabel/index.js';
import TextareaAutosize from '@mui/material/TextareaAutosize/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React, { lazy, Suspense, useState } from 'react';

import {
  getColorFromTheme,
  textareaEmphasisStyles } from './Textarea.styles';

/**
 * The rich editor is LOADED ON DEMAND, not imported (12-51 follow-up).
 *
 * It renders only for `variant === 'rich'`, but a static import made every
 * consumer of a plain `<Textarea>` pay for it — 387 lines of toolbar plus the
 * MUI `Tooltip`, `IconButton` and `Divider` its formatting buttons need. That
 * is not theoretical: an adopting storefront imports this entry for a one-line
 * order note, and `Tooltip` (8.7 KiB) reached its EAGER chunk through here
 * while nothing on that critical path renders a tooltip at all.
 *
 * `variant` is a prop, so the branch cannot be decided at build time and no
 * amount of tree-shaking removes it. A lazy boundary is what expresses "only
 * the rich variant pays", and it costs the rich variant one microtask it can
 * afford — it is a text editor a user has already chosen to open, never a
 * first-paint element.
 */
const TextareaRichEditor = lazy(async () => ({
  default: (await import('./TextareaRichEditor')).TextareaRichEditor }));
import type { TextareaProps } from './Textarea.types';

// Interface for styled component props
interface StyledTextareaProps {
  customVariant?: string;
  customColor?: string;
  customSize?: string;
  glow?: boolean;
  glass?: boolean;
  gradient?: boolean;
  error?: boolean;
  theme?: Theme;
}

// Glow animation for enhanced visual effects
const StyledTextarea = styled(TextareaAutosize, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'customSize', 'glow', 'glass', 'gradient', 'error'].includes(
      prop as string,
    ) })<StyledTextareaProps>(({
  theme,
  customVariant,
  customColor = 'primary',
  customSize = 'md',
  glow,
  glass,
  gradient,
  error }) => {
  if (!theme) return {};
  const colorPalette = getColorFromTheme(theme, customColor);
  const errorColor = theme.palette.error;

  const sizeMap = {
    xs: { padding: '6px 8px', fontSize: '0.75rem', minHeight: '60px' },
    sm: { padding: '8px 10px', fontSize: '0.875rem', minHeight: '80px' },
    md: { padding: '10px 12px', fontSize: '1rem', minHeight: '100px' },
    lg: { padding: '12px 14px', fontSize: '1.125rem', minHeight: '120px' },
    xl: { padding: '14px 16px', fontSize: '1.25rem', minHeight: '140px' } };

  const baseStyles = {
    width: '100%',
    fontFamily: theme.typography.fontFamily,
    borderRadius: theme.spacing(1),
    border: `2px solid ${error ? errorColor.main : theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    transition: 'all 0.3s ease',
    resize: customVariant === 'resizable' ? 'vertical' : 'none',
    outline: 'none',
    ...sizeMap[customSize as keyof typeof sizeMap],

    '&::placeholder': {
      color: theme.palette.text.secondary,
      opacity: 0.7 },

    '&:hover': {
      borderColor: error ? errorColor.dark : colorPalette.main,
      backgroundColor: alpha(theme.palette.background.paper, 0.8) },

    '&:focus': {
      borderColor: error ? errorColor.main : colorPalette.main,
      backgroundColor: theme.palette.background.paper,
      boxShadow: `0 0 0 3px ${alpha(error ? errorColor.main : colorPalette.main, 0.1)}` } };

  // Glass morphism effect
  return {
    ...baseStyles,
    ...textareaEmphasisStyles({ theme, colorPalette, glass, gradient, glow }) };
});

const StyledLabel = styled(InputLabel, {
  shouldForwardProp: (prop) => !['glass', 'error'].includes(prop as string) })<{ glass?: boolean; error?: boolean }>(({ theme, glass, error }) => ({
  marginBottom: theme.spacing(1),
  fontWeight: 500,
  color: error ? theme.palette.error.main : theme.palette.text.primary,
  ...(glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: 'blur(10px)',
    padding: '4px 8px',
    borderRadius: '4px',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    display: 'inline-block' }) }));

// IconWrapper - replaced with inline Box component for better TypeScript compatibility
// const IconWrapper = styled(Box)<{ position: 'start' | 'end' }>(({ theme, position }) => {
//   const positionStyles = position === 'start' ? { left: '12px' } : { right: '12px' };
//   return {
//     position: 'absolute' as const,
//     top: '12px',
//     ...positionStyles,
//     color: theme.palette.text.secondary,
//     pointerEvents: 'none' as const,
//     zIndex: 1,
//   };
// });

// Rich text toolbar styling

const ICON_GUTTER = '40px';

const TEXTAREA_DEFAULTS = {
  variant: 'default',
  color: 'primary',
  size: 'md',
  error: false,
  glassLabel: false,
  glow: false,
  glass: false,
  gradient: false,
  iconPosition: 'start',
  minRows: 3 } satisfies Partial<TextareaProps>;

// Strips explicitly-undefined props before the merge, so `prop={undefined}`
// still falls back to the default as a destructuring default would.
const definedProps = (props: TextareaProps): Partial<TextareaProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<TextareaProps>;

// Label above, helper text below — identical for the plain and rich variants,
// which previously duplicated both.
const TextareaShell: React.FC<{
  testId?: string;
  label?: React.ReactNode;
  glassLabel: boolean;
  error: boolean;
  helperText?: React.ReactNode;
  children: React.ReactNode;
}> = ({ testId, label, glassLabel, error, helperText, children }) => (
  <Box
    sx={{ position: 'relative', width: '100%' }}
    data-testid={testId ? `${testId}-wrapper` : undefined}
  >
    {label && (
      <StyledLabel glass={glassLabel} error={error}>
        {label}
      </StyledLabel>
    )}

    {children}

    {helperText && (
      <FormHelperText error={error} sx={{ mt: 1 }}>
        {helperText}
      </FormHelperText>
    )}
  </Box>
);

const TextareaIcon: React.FC<{
  icon?: React.ReactNode;
  iconPosition: 'start' | 'end';
}> = ({ icon, iconPosition }) => (
  <Box
    sx={{
      position: 'absolute',
      top: '12px',
      ...(iconPosition === 'start' ? { left: '12px' } : { right: '12px' }),
      color: 'text.secondary',
      pointerEvents: 'none',
      zIndex: 1 }}
  >
    {icon}
  </Box>
);

/**
 * The rich variant, kept out of the main component's body.
 *
 * Two reasons rather than one: the `Suspense` boundary and its props belong
 * together with the lazy import above, and the component that renders every
 * OTHER variant stays inside the size the complexity gate allows without
 * anything being suppressed.
 */
function RichVariant({
  shell,
  editor }: {
  shell: Omit<React.ComponentProps<typeof TextareaShell>, 'children'>;
  editor: React.ComponentProps<typeof TextareaRichEditor>;
}): React.JSX.Element {
  return (
    <TextareaShell {...shell}>
      {/*
        `null` rather than a spinner: the editor resolves from the same document
        the caller is already rendering, so a fallback would flash for a frame
        and read as a glitch rather than as loading.
      */}
      <Suspense fallback={null}>
        <TextareaRichEditor {...editor} />
      </Suspense>
    </TextareaShell>
  );
}

export const Textarea: React.FC<TextareaProps> = (textareaProps) => {
  const {
    variant,
    color,
    size,
    error,
    helperText,
    label,
    glassLabel,
    glow,
    glass,
    gradient,
    icon,
    iconPosition,
    minRows,
    maxRows,
    style,
    'data-testid': dataTestId,
    dataTestId: dataTestIdCamelCase,
    ...props
  } = { ...TEXTAREA_DEFAULTS, ...definedProps(textareaProps) };

  // Read off the props rather than the merged object: the spread widens every
  // key to optional, which would lose what the variant union already proved.
  const { richEditorCopy } = textareaProps;

  const [richTextValue, setRichTextValue] = useState('');
  const hasIcon = Boolean(icon);
  const testId = dataTestId || dataTestIdCamelCase;

  const textareaStyle = {
    ...style,
    // Same gap either side; only which side it applies to changes. The previous
    // version had `iconPosition === 'start' ? '40px' : '40px'`, a ternary whose
    // two branches were identical.
    ...(hasIcon && {
      [iconPosition === 'start' ? 'paddingLeft' : 'paddingRight']: ICON_GUTTER }) };

  // If rich text variant, use the rich text editor
  if (variant === 'rich' && richEditorCopy) {
    return (
      <RichVariant
        shell={{ testId, label, glassLabel, error, helperText }}
        editor={{
          copy: richEditorCopy,
          value: richTextValue,
          onChange: setRichTextValue,
          placeholder: props.placeholder,
          error,
          glass,
          color,
          characterLimit: props.maxLength }}
      />
    );
  }

  return (
    <TextareaShell testId={testId} label={label} glassLabel={glassLabel} error={error} helperText={helperText}>
      <Box sx={{ position: 'relative' }}>
        {hasIcon && <TextareaIcon icon={icon} iconPosition={iconPosition} />}

        <StyledTextarea
          customVariant={variant}
          customColor={color}
          customSize={size}
          glow={glow}
          glass={glass}
          gradient={gradient}
          error={error}
          minRows={variant === 'autosize' ? minRows : undefined}
          maxRows={variant === 'autosize' ? maxRows : undefined}
          style={textareaStyle}
          aria-label={label || props['aria-label']}
          data-testid={testId}
          {...props}
        />
      </Box>
    </TextareaShell>
  );
};

Textarea.displayName = 'Textarea';
