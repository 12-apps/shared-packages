import CodeIcon from '@mui/icons-material/Code';
import CopyIcon from '@mui/icons-material/ContentCopy';
import ExitFullscreenIcon from '@mui/icons-material/FullscreenExit';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import WrapIcon from '@mui/icons-material/WrapText';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
import React from 'react';

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
  readOnly,
  isWrapped,
  isCopied,
  isFullscreen,
  dataTestId,
  onFormat,
  onCopy,
  onWrapToggle,
  onFullscreenToggle,
}) => (
  <Stack direction="row" spacing={1}>
    {!readOnly && (
      <Tooltip title="Format Code (Ctrl+Shift+F)">
        <IconButton
          size="small"
          onClick={onFormat}
          data-testid={dataTestId ? `${dataTestId}-format-btn` : 'code-editor-format-btn'}
        >
          <CodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    )}

    <Tooltip title={isWrapped ? 'Disable Word Wrap' : 'Enable Word Wrap'}>
      <IconButton
        size="small"
        onClick={onWrapToggle}
        color={isWrapped ? 'primary' : 'default'}
        data-testid={dataTestId ? `${dataTestId}-wrap-btn` : 'code-editor-wrap-btn'}
      >
        <WrapIcon fontSize="small" />
      </IconButton>
    </Tooltip>

    <Tooltip title={isCopied ? 'Copied!' : 'Copy to Clipboard'}>
      <IconButton
        size="small"
        onClick={onCopy}
        color={isCopied ? 'success' : 'default'}
        data-testid={dataTestId ? `${dataTestId}-copy-btn` : 'code-editor-copy-btn'}
      >
        <CopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>

    <Tooltip title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>
      <IconButton
        size="small"
        onClick={onFullscreenToggle}
        data-testid={
          dataTestId ? `${dataTestId}-fullscreen-btn` : 'code-editor-fullscreen-btn'
        }
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

// Language badge, read-only marker and the four action buttons.
export const EditorToolbar: React.FC<{
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
}) => (
  <Toolbar data-testid={dataTestId ? `${dataTestId}-toolbar` : 'code-editor-toolbar'}>
    <Stack direction="row" spacing={2} alignItems="center">
      <LanguageBadge
        data-testid={
          dataTestId ? `${dataTestId}-language-badge` : 'code-editor-language-badge'
        }
      >
        <CodeIcon sx={{ fontSize: 14 }} />
        {language}
      </LanguageBadge>
      {readOnly && (
        <Typography variant="caption" color="text.secondary">
          Read Only
        </Typography>
      )}
    </Stack>

    <EditorActions
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
