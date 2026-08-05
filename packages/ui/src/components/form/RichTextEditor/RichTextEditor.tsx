import {
  alpha,
  Box,
  Paper,
  useTheme,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import DOMPurify from 'dompurify';
import React, { forwardRef, useCallback, useEffect,useRef, useState } from 'react';

import { applyFormatToRange } from './RichTextEditor.dom';
import { RichTextToolbar } from './RichTextEditor.toolbar';
import type { RichTextEditorProps, ToolbarConfig } from './RichTextEditor.types';

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
  customItems: [],
};

const RICH_TEXT_DEFAULTS: Partial<RichTextEditorProps> = {
  value: '',
  placeholder: 'Start typing...',
  disabled: false,
  readOnly: false,
  toolbar: {},
  height: 300,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}`
// still falls back to the default as a destructuring default would.
const definedProps = (props: RichTextEditorProps): Partial<RichTextEditorProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, v]) => v !== undefined),
  ) as Partial<RichTextEditorProps>;

// Content, focus and the format commands: everything the editor holds that is
// not a render.
const useRichTextEditor = ({
  value,
  maxLength,
  disabled,
  readOnly,
  onChange,
  onFocus,
  onBlur,
}: Pick<
  RichTextEditorProps,
  'value' | 'maxLength' | 'disabled' | 'readOnly' | 'onChange' | 'onFocus' | 'onBlur'
>) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [content, setContent] = useState(value ?? '');

  const handleContentChange = useCallback(() => {
    if (!editorRef.current) return;

    const newContent = editorRef.current.innerHTML;
    const textContent = editorRef.current.textContent || '';

    if (maxLength && textContent.length > maxLength) {
      // Restore previous content
      editorRef.current.innerHTML = content;

      return;
    }

    setContent(newContent);
    onChange?.(newContent);
  }, [maxLength, onChange, content]);

  const applyFormat = useCallback(
    (formatType: string, formatValue?: string) => {
      if (disabled || readOnly || !editorRef.current) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        editorRef.current.focus();

        return;
      }

      applyFormatToRange({
        formatType,
        value: formatValue,
        range: selection.getRangeAt(0),
        editor: editorRef.current,
      });

      handleContentChange();
      editorRef.current.focus();
    },
    [disabled, readOnly, handleContentChange],
  );

  return {
    editorRef,
    isFocused,
    content,
    handleContentChange,
    applyFormat,
    handleFocus: useCallback(() => {
      setIsFocused(true);
      onFocus?.();
    }, [onFocus]),
    handleBlur: useCallback(() => {
      setIsFocused(false);
      onBlur?.();
    }, [onBlur]),
  };
};

// Only the tags a document written in this editor can contain survive; anything
// else a paste brings in is dropped before it reaches the DOM.
const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'target', 'rel', 'style', 'class'],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });

// Calculate character count from text content
const textLength = (html: string) => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  return tempDiv.textContent?.length || 0;
};

// The frame: a focus ring, and the muted look a disabled editor takes on.
const frameSx = (theme: Theme, { isFocused, disabled }: { isFocused: boolean; disabled?: boolean }) => ({
  border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
  borderRadius: 1,
  overflow: 'hidden',
  transition: 'border-color 0.2s ease-in-out',
  ...(isFocused && {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
  }),
  ...(disabled && {
    backgroundColor: theme.palette.action.disabledBackground,
    color: theme.palette.text.disabled,
  }),
});

// The document surface, including how each tag the sanitizer allows renders.
const surfaceSx = (
  theme: Theme,
  { height, disabled, placeholder }: Pick<RichTextEditorProps, 'height' | 'disabled' | 'placeholder'>,
) => ({
  minHeight: typeof height === 'number' ? `${height}px` : height,
  p: 2,
  outline: 'none',
  cursor: disabled ? 'not-allowed' : 'text',
  '&:empty::before': {
    content: `"${placeholder}"`,
    color: theme.palette.text.disabled,
    pointerEvents: 'none',
  },
  '& p': {
    margin: '8px 0',
    '&:first-of-type': { marginTop: 0 },
    '&:last-of-type': { marginBottom: 0 },
  },
  '& ul, & ol': { marginLeft: theme.spacing(2) },
  '& blockquote': {
    borderLeft: `4px solid ${theme.palette.primary.main}`,
    paddingLeft: theme.spacing(2),
    margin: `${theme.spacing(1)} 0`,
    fontStyle: 'italic',
    backgroundColor: alpha(theme.palette.primary.main, 0.05),
  },
  '& pre': {
    backgroundColor: alpha(theme.palette.text.primary, 0.08),
    padding: theme.spacing(1),
    borderRadius: 1,
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    fontSize: '0.875rem',
    overflow: 'auto',
  },
  '& a': {
    color: theme.palette.primary.main,
    textDecoration: 'underline',
  },
});

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
    const { editorRef, isFocused, content, handleContentChange, applyFormat, handleFocus, handleBlur } =
      useRichTextEditor({ value, maxLength, disabled, readOnly, onChange, onFocus, onBlur });

    const toolbarConfig = { ...DEFAULT_TOOLBAR, ...toolbar };
    const sanitizedContent = sanitize(content);

    // Update editor content if it was sanitized differently
    useEffect(() => {
      if (editorRef.current && editorRef.current.innerHTML !== sanitizedContent) {
        editorRef.current.innerHTML = sanitizedContent;
      }
    }, [editorRef, sanitizedContent]);

    return (
      <Paper
        ref={ref}
        className={className}
        data-testid={testId || 'rich-text-editor'}
        elevation={1}
        sx={frameSx(theme, { isFocused, disabled })}
        {...props}
      >
        {/* Toolbar */}
        <RichTextToolbar
          config={toolbarConfig}
          characterCount={textLength(sanitizedContent)}
          maxLength={maxLength}
          editor={editorRef.current}
          disabled={disabled}
          readOnly={readOnly}
          onFormat={applyFormat}
        />

        {/* Editor */}
        <Box
          ref={editorRef}
          contentEditable={!disabled && !readOnly}
          onInput={handleContentChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          role="textbox"
          aria-label={ariaLabel || 'Rich text editor'}
          aria-describedby={ariaDescribedBy}
          aria-multiline="true"
          tabIndex={disabled ? -1 : 0}
          data-testid="editor-content"
          suppressContentEditableWarning
          sx={surfaceSx(theme, { height, disabled, placeholder })}
        />
      </Paper>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;