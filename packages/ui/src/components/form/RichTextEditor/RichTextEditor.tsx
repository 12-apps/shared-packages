import Code from '@mui/icons-material/Code';
import FormatBold from '@mui/icons-material/FormatBold';
import FormatItalic from '@mui/icons-material/FormatItalic';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';
import FormatQuote from '@mui/icons-material/FormatQuote';
import FormatStrikethrough from '@mui/icons-material/FormatStrikethrough';
import FormatUnderlined from '@mui/icons-material/FormatUnderlined';
import Image from '@mui/icons-material/Image';
import Link from '@mui/icons-material/Link';
import {
  alpha,
  Box,
  Divider,
  IconButton,
  Paper,
  Toolbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import DOMPurify from 'dompurify';
import React, { forwardRef, useCallback, useEffect,useRef, useState } from 'react';

import {
  insertImage,
  toggleList,
  wrapSelection,
  wrapSelectionWithLink,
} from './RichTextEditor.dom';
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

// Simple inline formats are a tag swap; lists and the value-carrying formats
// need their own handling. This was one nine-case switch.
const WRAP_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strikethrough: 's',
};

const LIST_TAGS: Record<string, 'ol' | 'ul'> = {
  insertOrderedList: 'ol',
  insertUnorderedList: 'ul',
};

// formatBlock is the only format whose value names the tag, and only these two
// are accepted.
const BLOCK_TAGS = new Set(['pre', 'blockquote']);

const applyFormatToRange = ({
  formatType,
  value,
  range,
  editor,
}: {
  formatType: string;
  value?: string;
  range: globalThis.Range;
  editor: HTMLElement | null;
}) => {
  const wrapTag = WRAP_TAGS[formatType];
  if (wrapTag) {
    wrapSelection(range, wrapTag);
    return;
  }

  const listTag = LIST_TAGS[formatType];
  if (listTag) {
    toggleList(range, listTag, editor);
    return;
  }

  if (formatType === 'createLink' && value) {
    wrapSelectionWithLink(range, value);
    return;
  }

  if (formatType === 'insertImage' && value) {
    insertImage(range, value);
    return;
  }

  if (formatType === 'formatBlock' && value && BLOCK_TAGS.has(value)) {
    wrapSelection(range, value);
  }
};

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
    const editorRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);
    const [content, setContent] = useState(value ?? '');

    const toolbarConfig = { ...DEFAULT_TOOLBAR, ...toolbar };

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

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onFocus?.();
    }, [onFocus]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
      onBlur?.();
    }, [onBlur]);

    const applyFormat = useCallback((formatType: string, value?: string) => {
      if (disabled || readOnly || !editorRef.current) return;
      
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        editorRef.current.focus();
        return;
      }
      
      const range = selection.getRangeAt(0);
      
      applyFormatToRange({ formatType, value, range, editor: editorRef.current });
      
      handleContentChange();
      editorRef.current.focus();
    }, [disabled, readOnly, handleContentChange]);
    
    
    
    

    const getToolbarButton = (
      key: string,
      icon: React.ReactElement,
      tooltip: string,
      command: string,
      commandValue?: string
    ) => {
      if (!toolbarConfig[key as keyof typeof toolbarConfig]) return null;

      const handleClick = () => {
        if (command === 'createLink') {
          const url = window.prompt('Enter URL:', 'https://');
          if (url) {
            applyFormat(command, url);
          }
        } else if (command === 'insertImage') {
          const src = window.prompt('Enter image URL:');
          if (src) {
            applyFormat(command, src);
          }
        } else {
          applyFormat(command, commandValue);
        }
      };

      return (
        <Tooltip key={key} title={tooltip}>
          <IconButton
            size="small"
            onClick={handleClick}
            disabled={disabled || readOnly}
            aria-label={tooltip}
            data-testid={`toolbar-${key}`}
          >
            {icon}
          </IconButton>
        </Tooltip>
      );
    };

    // Sanitize content for security
    const sanitizedContent = DOMPurify.sanitize(content, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'target', 'rel', 'style', 'class'],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    });
    
    // Calculate character count from text content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitizedContent;
    const characterCount = tempDiv.textContent?.length || 0;
    
    // Update editor content if it was sanitized differently
    useEffect(() => {
      if (editorRef.current && editorRef.current.innerHTML !== sanitizedContent) {
        editorRef.current.innerHTML = sanitizedContent;
      }
    }, [sanitizedContent]);

    return (
      <Paper
        ref={ref}
        className={className}
        data-testid={testId || 'rich-text-editor'}
        elevation={1}
        sx={{
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
        }}
        {...props}
      >
        {/* Toolbar */}
        <Toolbar
          variant="dense"
          data-testid="editor-toolbar"
          sx={{
            minHeight: 48,
            px: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            backgroundColor: alpha(theme.palette.background.paper, 0.8),
          }}
        >
          {getToolbarButton('bold', <FormatBold />, 'Bold', 'bold')}
          {getToolbarButton('italic', <FormatItalic />, 'Italic', 'italic')}
          {getToolbarButton('underline', <FormatUnderlined />, 'Underline', 'underline')}
          {getToolbarButton('strikethrough', <FormatStrikethrough />, 'Strikethrough', 'strikethrough')}
          
          {(toolbarConfig.bold || toolbarConfig.italic || toolbarConfig.underline || toolbarConfig.strikethrough) && 
           (toolbarConfig.orderedList || toolbarConfig.unorderedList) && (
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          )}
          
          {getToolbarButton('orderedList', <FormatListNumbered />, 'Numbered List', 'insertOrderedList')}
          {getToolbarButton('unorderedList', <FormatListBulleted />, 'Bulleted List', 'insertUnorderedList')}
          
          {(toolbarConfig.orderedList || toolbarConfig.unorderedList) && 
           (toolbarConfig.link || toolbarConfig.image || toolbarConfig.codeBlock || toolbarConfig.quote) && (
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          )}
          
          {getToolbarButton('link', <Link />, 'Insert Link', 'createLink')}
          {getToolbarButton('image', <Image />, 'Insert Image', 'insertImage')}
          {getToolbarButton('codeBlock', <Code />, 'Code Block', 'formatBlock', 'pre')}
          {getToolbarButton('quote', <FormatQuote />, 'Quote', 'formatBlock', 'blockquote')}
          
          {/* Custom toolbar items */}
          {toolbarConfig.customItems && toolbarConfig.customItems.length > 0 && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              {toolbarConfig.customItems.map((item) => (
                <Tooltip key={item.id} title={item.label}>
                  <IconButton
                    size="small"
                    onClick={() => item.action(editorRef.current)}
                    disabled={item.disabled || disabled || readOnly}
                    aria-label={item.label}
                    data-testid={`toolbar-custom-${item.id}`}
                  >
                    {item.icon}
                  </IconButton>
                </Tooltip>
              ))}
            </>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {/* Character count */}
          {maxLength && (
            <Typography
              variant="caption"
              color={characterCount > maxLength * 0.8 ? 'error' : 'text.secondary'}
              sx={{ mr: 1 }}
              data-testid="editor-counter"
            >
              {characterCount}/{maxLength}
            </Typography>
          )}
        </Toolbar>

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
          sx={{
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
              '&:first-of-type': {
                marginTop: 0,
              },
              '&:last-of-type': {
                marginBottom: 0,
              },
            },
            '& ul, & ol': {
              marginLeft: theme.spacing(2),
            },
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
          }}
        />
      </Paper>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;