import Box from '@mui/material/Box/index.js';
import Paper from '@mui/material/Paper/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import React, { forwardRef } from 'react';

import type { Theme } from '@mui/material/styles/index.js';
import { useRichTextEditor } from './RichTextEditor.hooks';
import type { RichTextEditorProps, ToolbarConfig } from './RichTextEditor.types';
import { RichTextEditorToolbar } from './RichTextEditorToolbar';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadiusPx } from '../../../tokens/field-radius';
import { rem } from '../../../tokens/relative';

const DEFAULT_TOOLBAR: Required<Omit<ToolbarConfig, 'customItems'>> & Pick<ToolbarConfig, 'customItems'> = {
  bold: true,
  italic: true,
  underline: true,
  strikethrough: false,
  orderedList: true,
  unorderedList: true,
  link: true,
  image: false,
  codeBlock: false,
  quote: false,
  customItems: [] };

const RICH_TEXT_DEFAULTS: Partial<RichTextEditorProps> = {
  value: '',
  placeholder: 'Start typing...',
  disabled: false,
  readOnly: false,
  toolbar: {} };

// Strips explicitly-undefined props before the merge, so `prop={undefined}`
// still falls back to the default as a destructuring default would.
const definedProps = (props: RichTextEditorProps): Partial<RichTextEditorProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, v]) => v !== undefined),
  ) as Partial<RichTextEditorProps>;

// Simple inline formats are a tag swap; lists and the value-carrying formats
// need their own handling. This was one nine-case switch.
const editorContentSx = (theme: Theme, disabled: boolean, placeholder?: string, height?: string | number) => ({
  // A number is design px, converted here where it is read (300 when the
  // caller gives none); a string is any CSS length, used as-is.
  minHeight: typeof height === 'string' ? height : rem(theme, height ?? 300),
  p: 2,
  outline: 'none',
  cursor: disabled ? 'not-allowed' : 'text',
  '&:empty::before': {
    content: `"${placeholder}"`,
    color: theme.palette.text.disabled,
    pointerEvents: 'none' },
  '& p': {
    margin: `${rem(theme, 8)} 0`,
    '&:first-of-type': { marginTop: 0 },
    '&:last-of-type': { marginBottom: 0 } },
  '& ul, & ol': { marginLeft: theme.spacing(2) },
  '& blockquote': {
    borderLeft: `${rem(theme, 4)} solid ${theme.palette.primary.main}`,
    paddingLeft: theme.spacing(2),
    margin: `${theme.spacing(1)} 0`,
    fontStyle: 'italic',
    backgroundColor: alpha(theme.palette.primary.main, 0.05) },
  '& pre': {
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
    padding: theme.spacing(1),
    borderRadius: 1,
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    fontSize: rem(theme, 14),
    overflow: 'auto' },
  '& a': { color: theme.palette.primary.main, textDecoration: 'underline' } });

const shellSx = (theme: Theme, isFocused: boolean, disabled: boolean) => ({
  border: `1px solid ${fieldEdge(theme)}`,
  borderRadius: fieldRadiusPx(theme),
  overflow: 'hidden',
  transition: 'border-color 0.2s ease-in-out',
  ...(isFocused && {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 ${rem(theme, 2)} ${alpha(theme.palette.primary.main, 0.2)}` }),
  ...(disabled && {
    backgroundColor: theme.palette.action.disabledBackground,
    color: theme.palette.text.disabled }) });

export const RichTextEditor = forwardRef<HTMLDivElement, RichTextEditorProps>(
  (editorProps, ref) => {
    const {
      value,
      onChange,
      placeholder,
      disabled,
      readOnly,
      toolbar,
      height,
      maxLength,
      onFocus,
      onBlur,
      className,
      'data-testid': testId,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      ...props
    } = { ...RICH_TEXT_DEFAULTS, ...definedProps(editorProps) } as RichTextEditorProps;

    const theme = useTheme();
    const toolbarConfig = { ...DEFAULT_TOOLBAR, ...toolbar };
    const editor = useRichTextEditor({
      value,
      onChange,
      onFocus,
      onBlur,
      disabled,
      readOnly,
      maxLength });

    return (
      <Paper
        ref={ref}
        className={className}
        data-testid={testId || 'rich-text-editor'}
        elevation={1}
        sx={shellSx(theme, editor.isFocused, Boolean(disabled))}
        {...props}
      >
        <RichTextEditorToolbar
          config={toolbarConfig}
          disabled={Boolean(disabled)}
          readOnly={Boolean(readOnly)}
          maxLength={maxLength}
          characterCount={editor.characterCount}
          editorRef={editor.editorRef}
          onFormat={editor.applyFormat}
        />

        <Box
          ref={editor.editorRef}
          contentEditable={!disabled && !readOnly}
          onInput={editor.handleContentChange}
          onFocus={editor.handleFocus}
          onBlur={editor.handleBlur}
          role="textbox"
          aria-label={ariaLabel || 'Rich text editor'}
          aria-describedby={ariaDescribedBy}
          aria-multiline="true"
          tabIndex={disabled ? -1 : 0}
          data-testid="editor-content"
          suppressContentEditableWarning
          sx={editorContentSx(theme, Boolean(disabled), placeholder, height)}
        />
      </Paper>
    );
  },
);

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;