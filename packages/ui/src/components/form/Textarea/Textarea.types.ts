import type { RichEditorToolbarCopy } from '../../../copy';
import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { TextareaAutosizeProps } from '@mui/material/TextareaAutosize/index.js';
import type React from 'react';

/**
 * The rich variant mounts a formatting toolbar of ten glyph buttons; the other
 * three variants mount no toolbar at all. So only that variant owes the words
 * — a plain textarea is not asked for tooltips it has nowhere to put.
 */
type TextareaRichCopy =
  | { variant?: 'default' | 'autosize' | 'resizable'; richEditorCopy?: never }
  | { variant: 'rich'; richEditorCopy: RichEditorToolbarCopy };

export type TextareaProps = TextareaBaseProps & TextareaRichCopy;

export interface TextareaBaseProps
  extends Omit<TextareaAutosizeProps, 'variant' | 'color' | 'size'> {
  /**
   * The variant of the textarea
   */
  variant?: 'default' | 'autosize' | 'resizable' | 'rich';
  
  /**
   * The color theme of the textarea
   */
  color?: ColorValue;
  
  /**
   * The size of the textarea
   */
  size?: SizeValue;
  
  /**
   * Whether the textarea has an error
   */
  error?: boolean;
  
  /**
   * Help text to display below the textarea
   */
  helperText?: string;
  
  /**
   * Label for the textarea
   */
  label?: string;
  
  /**
   * Whether the label should have a glass effect
   */
  glassLabel?: boolean;
  
  /**
   * Whether the textarea should have a glow effect
   */
  glow?: boolean;
  
  /**
   * Custom icon to display
   */
  icon?: React.ReactNode;
  
  /**
   * Position of the icon
   */
  iconPosition?: 'start' | 'end';
  
  /**
   * Whether the textarea should have glass morphism effect
   */
  glass?: boolean;
  
  /**
   * Whether the textarea should have gradient borders
   */
  gradient?: boolean;
  
  /**
   * How many lines of its own text the box opens at, in every variant.
   * Defaults to 4; pass it to override.
   */
  minRows?: number;
  
  /**
   * The most lines the `autosize` variant grows to before it scrolls.
   * The other variants ignore it.
   */
  maxRows?: number;

  /**
   * Custom test ID for testing
   */
  dataTestId?: string;

  /**
   * Data attribute for testing (HTML standard format)
   */
  'data-testid'?: string;
}