import Code from '@mui/icons-material/Code';
import FormatBold from '@mui/icons-material/FormatBold';
import FormatColorFill from '@mui/icons-material/FormatColorFill';
import FormatColorText from '@mui/icons-material/FormatColorText';
import FormatItalic from '@mui/icons-material/FormatItalic';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';
import FormatQuote from '@mui/icons-material/FormatQuote';
import FormatUnderlined from '@mui/icons-material/FormatUnderlined';
import Link from '@mui/icons-material/Link';
import Box from '@mui/material/Box/index.js';
import Divider from '@mui/material/Divider/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import { alpha, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React, { useEffect, useRef, useState } from 'react';

import { floatAnimation, getColorFromTheme } from './Textarea.styles';
import type { RichEditorToolbarCopy } from '../../../copy';

const RichToolbar = styled(Box)<{ glass?: boolean }>(({ theme, glass }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  padding: theme.spacing(1),
  borderRadius: `${theme.spacing(1)} ${theme.spacing(1)} 0 0`,
  borderBottom: `1px solid ${theme.palette.divider}`,
  background: glass ? alpha(theme.palette.background.paper, 0.1) : theme.palette.background.paper,
  ...(glass && {
    backdropFilter: 'blur(15px)' }),
  '& .MuiDivider-root': {
    height: 24,
    margin: `0 ${theme.spacing(1)}` } }));

const ToolbarButton = styled(IconButton, {
  shouldForwardProp: (prop) => prop !== 'active' })<{ active?: boolean }>(({ theme, active }) => ({
  padding: theme.spacing(0.75),
  borderRadius: theme.spacing(0.5),
  color: active ? theme.palette.primary.main : theme.palette.text.secondary,
  backgroundColor: active ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
  transition: 'all 0.2s ease',
  position: 'relative',
  overflow: 'hidden',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
    borderRadius: '50%',
    backgroundColor: alpha(theme.palette.primary.main, 0.3),
    transform: 'translate(-50%, -50%)',
    transition: 'width 0.3s, height 0.3s' },

  '&:hover': {
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.15),
    transform: 'translateY(-1px)',
    animation: `${floatAnimation} 1.5s ease-in-out infinite`,

    '&::before': {
      width: '100%',
      height: '100%' } },

  '&:active': {
    transform: 'scale(0.95)' } }));

const CharacterCount = styled(Box)<{ limit?: number; count: number }>(({ theme, limit, count }) => {
  const isWarning = limit && count > limit * 0.8;
  const isError = limit && count > limit;

  return {
    position: 'absolute',
    bottom: theme.spacing(1),
    right: theme.spacing(1),
    fontSize: '0.75rem',
    color: isError
      ? theme.palette.error.main
      : isWarning
        ? theme.palette.warning.main
        : theme.palette.text.secondary,
    padding: '2px 6px',
    borderRadius: theme.spacing(0.5),
    backgroundColor: alpha(theme.palette.background.paper, 0.8),
    backdropFilter: 'blur(10px)',
    transition: 'all 0.3s ease' };
});

const ContentEditableDiv = styled('div')<{
  error?: boolean;
  focused?: boolean;
  glass?: boolean;
  customColor?: string;
  theme?: Theme;
}>(({ theme, error, focused, glass, customColor = 'primary' }) => {
  if (!theme) return {};
  const colorPalette = getColorFromTheme(theme, customColor);
  const errorColor = theme.palette.error;

  return {
    minHeight: '120px',
    padding: theme.spacing(1.5),
    borderRadius: `0 0 ${theme.spacing(1)} ${theme.spacing(1)}`,
    border: `2px solid ${error ? errorColor.main : focused ? colorPalette.main : theme.palette.divider}`,
    borderTop: 'none',
    backgroundColor: glass
      ? alpha(theme.palette.background.paper, 0.1)
      : theme.palette.background.paper,
    color: theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: '1rem',
    lineHeight: 1.5,
    outline: 'none',
    transition: 'all 0.3s ease',
    cursor: 'text',

    ...(glass && {
      backdropFilter: 'blur(20px)' }),

    '&:hover': {
      backgroundColor: glass
        ? alpha(theme.palette.background.paper, 0.15)
        : alpha(theme.palette.background.paper, 0.9) },

    '&:focus': {
      borderColor: error ? errorColor.main : colorPalette.main,
      boxShadow: `0 0 0 3px ${alpha(error ? errorColor.main : colorPalette.main, 0.1)}` },

    '& > *': {
      margin: '0.5em 0' },

    '&[contenteditable="true"]:empty::before': {
      content: 'attr(data-placeholder)',
      color: theme.palette.text.secondary,
      opacity: 0.6 } };
});

// Rich text formatting functions
const formatText = (command: string, value?: string) => {
  document.execCommand(command, false, value);
};

// Editable state: what is typed, how long it is, and which formats apply at the
// caret. Kept apart from the markup below.
const useRichEditorState = ({
  value,
  onChange }: {
  value?: string;
  onChange?: (html: string) => void;
}) => {
  const [focused, setFocused] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    list: false,
    orderedList: false,
    quote: false,
    code: false });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current && value !== undefined) {
      if (contentRef.current.innerHTML !== value) {
        contentRef.current.innerHTML = value;
      }
      setCharacterCount(contentRef.current.innerText.length);
    }
  }, [value]);

  const handleInput = () => {
    if (contentRef.current) {
      const html = contentRef.current.innerHTML;
      onChange?.(html);
      setCharacterCount(contentRef.current.innerText.length);
      updateActiveFormats();
    }
  };

  const updateActiveFormats = () => {
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      list: document.queryCommandState('insertUnorderedList'),
      orderedList: document.queryCommandState('insertOrderedList'),
      quote: false,
      code: false });
  };

  const handleFormat = (command: string, value?: string) => {
    formatText(command, value);
    updateActiveFormats();
    contentRef.current?.focus();
  };

  return {
    focused,
    setFocused,
    characterCount,
    activeFormats,
    contentRef,
    handleInput,
    handleFormat,
    updateActiveFormats };
};

const InlineFormatButtons: React.FC<{
  copy: RichEditorToolbarCopy;
  activeFormats: Record<string, boolean>;
  onCommand: (command: string, value?: string) => void;
}> = ({ copy, activeFormats, onCommand }) => (
  <>
    <Tooltip title={copy.bold} arrow>
      <ToolbarButton
        size="small"
        active={activeFormats.bold}
        onClick={() => onCommand('bold')}
      >
        <FormatBold fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.italic} arrow>
      <ToolbarButton
        size="small"
        active={activeFormats.italic}
        onClick={() => onCommand('italic')}
      >
        <FormatItalic fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.underline} arrow>
      <ToolbarButton
        size="small"
        active={activeFormats.underline}
        onClick={() => onCommand('underline')}
      >
        <FormatUnderlined fontSize="small" />
      </ToolbarButton>
    </Tooltip>

  </>
);

const BlockFormatButtons: React.FC<{
  copy: RichEditorToolbarCopy;
  activeFormats: Record<string, boolean>;
  onCommand: (command: string, value?: string) => void;
}> = ({ copy, activeFormats, onCommand }) => (
  <>
    <Divider orientation="vertical" flexItem />

    <Tooltip title={copy.bulletList} arrow>
      <ToolbarButton
        size="small"
        active={activeFormats.list}
        onClick={() => onCommand('insertUnorderedList')}
      >
        <FormatListBulleted fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.numberedList} arrow>
      <ToolbarButton
        size="small"
        active={activeFormats.orderedList}
        onClick={() => onCommand('insertOrderedList')}
      >
        <FormatListNumbered fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Divider orientation="vertical" flexItem />

    <Tooltip title={copy.quote} arrow>
      <ToolbarButton size="small" onClick={() => onCommand('formatBlock', 'blockquote')}>
        <FormatQuote fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.code} arrow>
      <ToolbarButton size="small" onClick={() => onCommand('formatBlock', 'pre')}>
        <Code fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Divider orientation="vertical" flexItem />

    <Tooltip title={copy.insertLink} arrow>
      <ToolbarButton
        size="small"
        onClick={() => {
          const url = window.prompt(copy.linkPrompt);
          if (url) onCommand('createLink', url);
        }}
      >
        <Link fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.textColor} arrow>
      <ToolbarButton size="small">
        <FormatColorText fontSize="small" />
      </ToolbarButton>
    </Tooltip>

    <Tooltip title={copy.backgroundColor} arrow>
      <ToolbarButton size="small">
        <FormatColorFill fontSize="small" />
      </ToolbarButton>
    </Tooltip>
  </>
);

// The formatting buttons. Split out so the editor body is state, handlers and
// the editable region.
const EditorToolbar: React.FC<{
  copy: RichEditorToolbarCopy;
  glass?: boolean;
  activeFormats: Record<string, boolean>;
  onCommand: (command: string, value?: string) => void;
}> = ({ copy, glass, activeFormats, onCommand }) => (
  <RichToolbar glass={glass}>
    <InlineFormatButtons copy={copy} activeFormats={activeFormats} onCommand={onCommand} />
    <BlockFormatButtons copy={copy} activeFormats={activeFormats} onCommand={onCommand} />
  </RichToolbar>
);

export const TextareaRichEditor: React.FC<{
  /**
   * The ten toolbar buttons' tooltips — which are also their accessible names,
   * since every one of them is a glyph — plus the link prompt. REQUIRED: this
   * package ships no default copy.
   */
  copy: RichEditorToolbarCopy;
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  error?: boolean;
  glass?: boolean;
  color?: string;
  characterLimit?: number;
}> = ({ copy, value, onChange, placeholder, error, glass, color, characterLimit }) => {
  const {
    focused,
    setFocused,
    characterCount,
    activeFormats,
    contentRef,
    handleInput,
    handleFormat,
    updateActiveFormats } = useRichEditorState({ value, onChange });

  return (
    <Box sx={{ position: 'relative' }}>
      <EditorToolbar copy={copy} glass={glass} activeFormats={activeFormats} onCommand={handleFormat} />

      <ContentEditableDiv
        ref={contentRef}
        contentEditable
        data-placeholder={placeholder}
        error={error}
        focused={focused}
        glass={glass}
        customColor={color}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onInput={handleInput}
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder || 'Rich text editor'}
      />

      {characterLimit && (
        <CharacterCount limit={characterLimit} count={characterCount}>
          {characterCount}
          {characterLimit ? `/${characterLimit}` : ''}
        </CharacterCount>
      )}
    </Box>
  );
};
