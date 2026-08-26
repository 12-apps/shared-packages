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
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { FC, ReactElement } from 'react';
import React from 'react';

import type { ToolbarConfig } from './RichTextEditor.types';

type ResolvedToolbar = Required<Omit<ToolbarConfig, 'customItems'>> &
  Pick<ToolbarConfig, 'customItems'>;

// The button groups, in render order. A separator is drawn between two groups
// only when both actually have something switched on.
const GROUPS: Array<Array<{ key: keyof ResolvedToolbar; icon: ReactElement; tooltip: string; command: string; commandValue?: string }>> = [
  [
    { key: 'bold', icon: <FormatBold />, tooltip: 'Bold', command: 'bold' },
    { key: 'italic', icon: <FormatItalic />, tooltip: 'Italic', command: 'italic' },
    { key: 'underline', icon: <FormatUnderlined />, tooltip: 'Underline', command: 'underline' },
    {
      key: 'strikethrough',
      icon: <FormatStrikethrough />,
      tooltip: 'Strikethrough',
      command: 'strikethrough',
    },
  ],
  [
    {
      key: 'orderedList',
      icon: <FormatListNumbered />,
      tooltip: 'Numbered List',
      command: 'insertOrderedList',
    },
    {
      key: 'unorderedList',
      icon: <FormatListBulleted />,
      tooltip: 'Bulleted List',
      command: 'insertUnorderedList',
    },
  ],
  [
    { key: 'link', icon: <Link />, tooltip: 'Insert Link', command: 'createLink' },
    { key: 'image', icon: <Image />, tooltip: 'Insert Image', command: 'insertImage' },
    {
      key: 'codeBlock',
      icon: <Code />,
      tooltip: 'Code Block',
      command: 'formatBlock',
      commandValue: 'pre',
    },
    {
      key: 'quote',
      icon: <FormatQuote />,
      tooltip: 'Quote',
      command: 'formatBlock',
      commandValue: 'blockquote',
    },
  ],
];

// Link and image need a target before they can run.
const PROMPTS: Record<string, { message: string; initial?: string }> = {
  createLink: { message: 'Enter URL:', initial: 'https://' },
  insertImage: { message: 'Enter image URL:' },
};

const Separator: FC = () => <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />;

export interface RichTextEditorToolbarProps {
  config: ResolvedToolbar;
  disabled: boolean;
  readOnly: boolean;
  maxLength?: number;
  characterCount: number;
  editorRef: React.RefObject<HTMLDivElement | null>;
  onFormat: (command: string, value?: string) => void;
}

const ToolbarGroups: FC<{
  config: ResolvedToolbar;
  disabled: boolean;
  readOnly: boolean;
  onRun: (command: string, commandValue?: string) => void;
}> = ({ config, disabled, readOnly, onRun }) => {
  const groupIsActive = (group: (typeof GROUPS)[number]) => group.some((item) => config[item.key]);

  return (
    <>
      {GROUPS.map((group, groupIndex) => (
        <React.Fragment key={group[0]?.key ?? groupIndex}>
          {groupIsActive(group) && GROUPS.slice(0, groupIndex).some(groupIsActive) && <Separator />}
          {group
            .filter((item) => config[item.key])
            .map((item) => (
              <Tooltip key={item.key} title={item.tooltip}>
                <IconButton
                  size="small"
                  onClick={() => onRun(item.command, item.commandValue)}
                  disabled={disabled || readOnly}
                  aria-label={item.tooltip}
                  data-testid={`toolbar-${item.key}`}
                >
                  {item.icon}
                </IconButton>
              </Tooltip>
            ))}
        </React.Fragment>
      ))}
    </>
  );
};

export const RichTextEditorToolbar: FC<RichTextEditorToolbarProps> = ({
  config,
  disabled,
  readOnly,
  maxLength,
  characterCount,
  editorRef,
  onFormat,
}) => {
  const run = (command: string, commandValue?: string) => {
    const prompt = PROMPTS[command];
    if (!prompt) {
      onFormat(command, commandValue);
      return;
    }

    const answer = window.prompt(prompt.message, prompt.initial);
    if (answer) onFormat(command, answer);
  };

  return (
    <Toolbar
      variant="dense"
      data-testid="editor-toolbar"
      sx={{
        minHeight: 48,
        px: 1,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.8),
      }}
    >
      <ToolbarGroups config={config} disabled={disabled} readOnly={readOnly} onRun={run} />

      {config.customItems && config.customItems.length > 0 && (
        <>
          <Separator />
          {config.customItems.map((item) => (
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

      {maxLength && (
        <Typography
          variant="caption"
          // Turns red in the last fifth of the allowance.
          color={characterCount > maxLength * 0.8 ? 'error' : 'text.secondary'}
          sx={{ mr: 1 }}
          data-testid="editor-counter"
        >
          {characterCount}/{maxLength}
        </Typography>
      )}
    </Toolbar>
  );
};
