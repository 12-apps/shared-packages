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
import { alpha, Box, Divider, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';

import type { ToolbarConfig } from './RichTextEditor.types';

type Config = Required<Omit<ToolbarConfig, 'customItems'>> & Pick<ToolbarConfig, 'customItems'>;

type Applies = { disabled?: boolean; readOnly?: boolean; onFormat: (command: string, value?: string) => void };

// Two commands need a URL before they can run; the rest apply straight away.
const PROMPTS: Record<string, { message: string; initial?: string }> = {
  createLink: { message: 'Enter URL:', initial: 'https://' },
  insertImage: { message: 'Enter image URL:' },
};

const ToolbarButton: React.FC<
  Applies & {
    name: keyof Config;
    config: Config;
    icon: React.ReactElement;
    tooltip: string;
    command: string;
    commandValue?: string;
  }
> = ({ name, config, icon, tooltip, command, commandValue, disabled, readOnly, onFormat }) => {
  if (!config[name]) return null;

  const handleClick = () => {
    const prompt = PROMPTS[command];
    if (!prompt) return onFormat(command, commandValue);

    const answer = window.prompt(prompt.message, prompt.initial);
    if (answer) onFormat(command, answer);
  };

  return (
    <Tooltip key={name} title={tooltip}>
      <IconButton
        size="small"
        onClick={handleClick}
        disabled={disabled || readOnly}
        aria-label={tooltip}
        data-testid={`toolbar-${name}`}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
};

// A divider earns its place only between two groups that both have buttons.
const GroupDivider: React.FC<{ before: boolean; after: boolean }> = ({ before, after }) =>
  before && after ? <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} /> : null;

const CustomItems: React.FC<
  Pick<Applies, 'disabled' | 'readOnly'> & {
    items: ToolbarConfig['customItems'];
    editor: HTMLDivElement | null;
  }
> = ({ items, editor, disabled, readOnly }) => {
  if (!items || items.length === 0) return null;

  return (
    <>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      {items.map((item) => (
        <Tooltip key={item.id} title={item.label}>
          <IconButton
            size="small"
            onClick={() => item.action(editor)}
            disabled={item.disabled || disabled || readOnly}
            aria-label={item.label}
            data-testid={`toolbar-custom-${item.id}`}
          >
            {item.icon}
          </IconButton>
        </Tooltip>
      ))}
    </>
  );
};

// Turns red once the document is within a fifth of the limit.
const CharacterCount: React.FC<{ count: number; maxLength?: number }> = ({ count, maxLength }) =>
  maxLength ? (
    <Typography
      variant="caption"
      color={count > maxLength * 0.8 ? 'error' : 'text.secondary'}
      sx={{ mr: 1 }}
      data-testid="editor-counter"
    >
      {count}/{maxLength}
    </Typography>
  ) : null;

const INLINE = [
  { name: 'bold', icon: <FormatBold />, tooltip: 'Bold', command: 'bold' },
  { name: 'italic', icon: <FormatItalic />, tooltip: 'Italic', command: 'italic' },
  { name: 'underline', icon: <FormatUnderlined />, tooltip: 'Underline', command: 'underline' },
  {
    name: 'strikethrough',
    icon: <FormatStrikethrough />,
    tooltip: 'Strikethrough',
    command: 'strikethrough',
  },
] as const;

const LISTS = [
  {
    name: 'orderedList',
    icon: <FormatListNumbered />,
    tooltip: 'Numbered List',
    command: 'insertOrderedList',
  },
  {
    name: 'unorderedList',
    icon: <FormatListBulleted />,
    tooltip: 'Bulleted List',
    command: 'insertUnorderedList',
  },
] as const;

const BLOCKS = [
  { name: 'link', icon: <Link />, tooltip: 'Insert Link', command: 'createLink' },
  { name: 'image', icon: <Image />, tooltip: 'Insert Image', command: 'insertImage' },
  {
    name: 'codeBlock',
    icon: <Code />,
    tooltip: 'Code Block',
    command: 'formatBlock',
    commandValue: 'pre',
  },
  {
    name: 'quote',
    icon: <FormatQuote />,
    tooltip: 'Quote',
    command: 'formatBlock',
    commandValue: 'blockquote',
  },
] as const;

const anyEnabled = (config: Config, group: readonly { name: keyof Config }[]) =>
  group.some((entry) => Boolean(config[entry.name]));

export const RichTextToolbar: React.FC<
  Applies & {
    config: Config;
    characterCount: number;
    maxLength?: number;
    editor: HTMLDivElement | null;
  }
> = ({ config, characterCount, maxLength, editor, disabled, readOnly, onFormat }) => {
  const theme = useTheme();
  const applies = { config, disabled, readOnly, onFormat };

  return (
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
      {INLINE.map((entry) => (
        <ToolbarButton key={entry.name} {...entry} {...applies} />
      ))}

      <GroupDivider before={anyEnabled(config, INLINE)} after={anyEnabled(config, LISTS)} />

      {LISTS.map((entry) => (
        <ToolbarButton key={entry.name} {...entry} {...applies} />
      ))}

      <GroupDivider before={anyEnabled(config, LISTS)} after={anyEnabled(config, BLOCKS)} />

      {BLOCKS.map((entry) => (
        <ToolbarButton key={entry.name} {...entry} {...applies} />
      ))}

      {/* Custom toolbar items */}
      <CustomItems
        items={config.customItems}
        editor={editor}
        disabled={disabled}
        readOnly={readOnly}
      />

      <Box sx={{ flexGrow: 1 }} />

      {/* Character count */}
      <CharacterCount count={characterCount} maxLength={maxLength} />
    </Toolbar>
  );
};
