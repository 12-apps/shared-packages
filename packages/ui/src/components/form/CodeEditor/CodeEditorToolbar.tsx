import CodeIcon from '@mui/icons-material/Code';
import CopyIcon from '@mui/icons-material/ContentCopy';
import ExitFullscreenIcon from '@mui/icons-material/FullscreenExit';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import WrapIcon from '@mui/icons-material/WrapText';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, styled } from '@mui/material/styles';
import React from 'react';

import type { CodeEditorCopy } from '../../../copy';

// Each button repeated the same conditional test id; this is that ternary once.
const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `code-editor-${suffix}`;

const Toolbar = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
  background: alpha(theme.palette.background.default, 0.4),
}));

const LanguageBadge = styled(Box)(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  padding: theme.spacing(0.5, 1),
  borderRadius: theme.shape.borderRadius,
  background: alpha(theme.palette.primary.main, 0.1),
  color: theme.palette.primary.main,
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}));

const EditorActions: React.FC<{
  copy: CodeEditorCopy;
  readOnly: boolean;
  isWrapped: boolean;
  isCopied: boolean;
  isFullscreen: boolean;
  dataTestId?: string;
  onFormat: () => void;
  onCopy: () => void;
  onWrapToggle: () => void;
  onFullscreenToggle: () => void;
}> = ({
  copy,
  readOnly,
  isWrapped,
  isCopied,
  isFullscreen,
  dataTestId,
  onFormat,
  onCopy,
  onWrapToggle,
  onFullscreenToggle,
}) => {
  const testId = makeTestId(dataTestId);

  return (
    <Stack direction="row" spacing={1}>
    {!readOnly && (
      <Tooltip title={copy.formatCode}>
        <IconButton
          size="small"
          onClick={onFormat}
          data-testid={testId('format-btn')}
        >
          <CodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    )}

    <Tooltip title={isWrapped ? copy.disableWrap : copy.enableWrap}>
      <IconButton
        size="small"
        onClick={onWrapToggle}
        color={isWrapped ? 'primary' : 'default'}
        data-testid={testId('wrap-btn')}
      >
        <WrapIcon fontSize="small" />
      </IconButton>
    </Tooltip>

    <Tooltip title={isCopied ? copy.copied : copy.copyToClipboard}>
      <IconButton
        size="small"
        onClick={onCopy}
        color={isCopied ? 'success' : 'default'}
        data-testid={testId('copy-btn')}
      >
        <CopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>

    <Tooltip title={isFullscreen ? copy.exitFullscreen : copy.enterFullscreen}>
      <IconButton
        size="small"
        onClick={onFullscreenToggle}
        data-testid={testId('fullscreen-btn')}
      >
        {isFullscreen ? (
          <ExitFullscreenIcon fontSize="small" />
        ) : (
          <FullscreenIcon fontSize="small" />
        )}
      </IconButton>
      </Tooltip>
    </Stack>
  );
};

// Language badge, read-only marker and the four action buttons.
export const EditorToolbar: React.FC<{
  copy: CodeEditorCopy;
  language: string;
  readOnly: boolean;
  isWrapped: boolean;
  isCopied: boolean;
  isFullscreen: boolean;
  dataTestId?: string;
  onFormat: () => void;
  onCopy: () => void;
  onWrapToggle: () => void;
  onFullscreenToggle: () => void;
}> = ({
  copy,
  language,
  readOnly,
  isWrapped,
  isCopied,
  isFullscreen,
  dataTestId,
  onFormat,
  onCopy,
  onWrapToggle,
  onFullscreenToggle,
}) => {
  const testId = makeTestId(dataTestId);

  return (
  <Toolbar data-testid={testId('toolbar')}>
    <Stack direction="row" spacing={2} alignItems="center">
      <LanguageBadge data-testid={testId('language-badge')}>
        <CodeIcon sx={{ fontSize: 14 }} />
        {language}
      </LanguageBadge>
      {readOnly && (
        <Typography variant="caption" color="text.secondary">
          {copy.readOnly}
        </Typography>
      )}
    </Stack>

    <EditorActions
      copy={copy}
      readOnly={readOnly}
      isWrapped={isWrapped}
      isCopied={isCopied}
      isFullscreen={isFullscreen}
      dataTestId={dataTestId}
      onFormat={onFormat}
      onCopy={onCopy}
      onWrapToggle={onWrapToggle}
      onFullscreenToggle={onFullscreenToggle}
    />
  </Toolbar>
  );
};
