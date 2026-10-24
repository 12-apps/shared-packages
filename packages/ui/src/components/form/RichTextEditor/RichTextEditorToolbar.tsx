import type { RichTextEditorLabels } from '../../../copy/labels';
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
import Box from '@mui/material/Box/index.js';
import Divider from '@mui/material/Divider/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Toolbar from '@mui/material/Toolbar/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha } from '@mui/material/styles/index.js';
import type { FC, ReactElement } from 'react';
import React from 'react';

import type { ToolbarConfig } from './RichTextEditor.types';

import { sxRem } from '../../../tokens/relative';

type ResolvedToolbar = Required<Omit<ToolbarConfig, 'customItems'>> &
  Pick<ToolbarConfig, 'customItems'>;

// The button groups, in render order. A separator is drawn between two groups
// only when both actually have something switched on.
const GROUPS: Array<Array<{ key: keyof ResolvedToolbar; icon: ReactElement; label: keyof RichTextEditorLabels; command: string; commandValue?: string }>> = [
  [
    { key: 'bold', icon: <FormatBold />, label: 'bold', command: 'bold' },
    { key: 'italic', icon: <FormatItalic />, label: 'italic', command: 'italic' },
    { key: 'underline', icon: <FormatUnderlined />, label: 'underline', command: 'underline' },
    {
      key: 'strikethrough',
      icon: <FormatStrikethrough />,
      label: 'strikethrough',
      command: 'strikethrough',
    },
  ],
  [
    {
      key: 'orderedList',
      icon: <FormatListNumbered />,
      label: 'numberedList',
      command: 'insertOrderedList',
    },
    {
      key: 'unorderedList',
      icon: <FormatListBulleted />,
      label: 'bulletedList',
      command: 'insertUnorderedList',
    },
  ],
  [
    { key: 'link', icon: <Link />, label: 'insertLink', command: 'createLink' },
    { key: 'image', icon: <Image />, label: 'insertImage', command: 'insertImage' },
    {
      key: 'codeBlock',
      icon: <Code />,
      label: 'codeBlock',
      command: 'formatBlock',
      commandValue: 'pre',
    },
    {
      key: 'quote',
      icon: <FormatQuote />,
      label: 'quote',
      command: 'formatBlock',
      commandValue: 'blockquote',
    },
  ],
];

// Link and image need a target before they can run.
const PROMPTS: Record<string, { message: 'linkPrompt' | 'imagePrompt'; initial?: string }> = {
  createLink: { message: 'linkPrompt', initial: 'https://' },
  insertImage: { message: 'imagePrompt' },
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
  labels: RichTextEditorLabels;
}

const ToolbarGroups: FC<{
  config: ResolvedToolbar;
  disabled: boolean;
  readOnly: boolean;
  onRun: (command: string, commandValue?: string) => void;
  labels: RichTextEditorLabels;
}> = ({ config, disabled, readOnly, onRun, labels }) => {
  const groupIsActive = (group: (typeof GROUPS)[number]) => group.some((item) => config[item.key]);

  return (
    <>
      {GROUPS.map((group, groupIndex) => (
        <React.Fragment key={group[0]?.key ?? groupIndex}>
          {groupIsActive(group) && GROUPS.slice(0, groupIndex).some(groupIsActive) && <Separator />}
          {group
            .filter((item) => config[item.key])
            .map((item) => (
              <Tooltip key={item.key} title={labels[item.label]}>
                <IconButton
                  size="small"
                  onClick={() => onRun(item.command, item.commandValue)}
                  disabled={disabled || readOnly}
                  aria-label={labels[item.label]}
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
  labels,
}) => {
  const run = (command: string, commandValue?: string) => {
    const prompt = PROMPTS[command];
    if (!prompt) {
      onFormat(command, commandValue);
      return;
    }

    const answer = window.prompt(labels[prompt.message], prompt.initial);
    if (answer) onFormat(command, answer);
  };

  return (
    <Toolbar
      variant="dense"
      data-testid="editor-toolbar"
      sx={{
        minHeight: sxRem(48),
        px: 1,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.8),
      }}
    >
      <ToolbarGroups
        config={config}
        disabled={disabled}
        readOnly={readOnly}
        onRun={run}
        labels={labels}
      />

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
