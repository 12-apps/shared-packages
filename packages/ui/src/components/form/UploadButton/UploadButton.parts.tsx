import AttachFileOutlined from '@mui/icons-material/AttachFileOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type React from 'react';

import type { DragHandlers } from './UploadButton.hooks';
import type { UploadButtonCopy } from '../../../copy';
import type { UploadButtonProps } from './UploadButton.types';

/** Shared shape for the two trigger variants. */
export interface TriggerProps {
  copy: UploadButtonCopy;
  label: string;
  icon?: React.ReactNode;
  disabled: boolean;
  className?: string;
  dataTestId?: string;
  describedBy?: string;
  onOpen: () => void;
}

/** The drag-and-drop surface. */
export function UploadDropzone({
  copy,
  label,
  icon,
  disabled,
  className,
  dataTestId,
  describedBy,
  onOpen,
  isDragOver,
  drag,
}: TriggerProps & { isDragOver: boolean; drag: DragHandlers }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box
      component="div"
      {...drag}
      onClick={onOpen}
      sx={{
        border: `2px dashed ${isDragOver ? theme.palette.primary.main : theme.palette.divider}`,
        borderRadius: 2,
        padding: 3,
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: isDragOver ? `${theme.palette.primary.main}0A` : 'transparent',
        transition: 'all 0.2s ease-in-out',
        ...(!disabled && {
          '&:hover': {
            borderColor: theme.palette.primary.main,
            backgroundColor: `${theme.palette.primary.main}05`,
          },
        }),
        opacity: disabled ? 0.6 : 1,
      }}
      className={className}
      data-testid={dataTestId}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
      aria-describedby={describedBy}
      aria-label={copy.dropzoneRole(label)}
    >
      <Box sx={{ mb: 2 }}>
        {icon || <CloudUploadOutlined sx={{ fontSize: 48, color: 'text.secondary' }} />}
      </Box>
      <Typography variant="body1" sx={{ mb: 1 }}>
        {label}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {copy.dropzoneHint}
      </Typography>
    </Box>
  );
}

/** MUI variant for each non-dropzone appearance. */
const MUI_VARIANT = { outline: 'outlined', ghost: 'text' } as const;

/** The plain-button trigger. */
export function UploadTrigger({
  copy,
  label,
  icon,
  disabled,
  className,
  dataTestId,
  describedBy,
  onOpen,
  variant,
  isUploading,
}: TriggerProps & {
  variant: NonNullable<UploadButtonProps['variant']>;
  isUploading: boolean;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <Button
      variant={MUI_VARIANT[variant as keyof typeof MUI_VARIANT] ?? 'contained'}
      disabled={disabled || isUploading}
      onClick={onOpen}
      startIcon={icon || <AttachFileOutlined />}
      className={className}
      data-testid={dataTestId}
      aria-describedby={describedBy}
      sx={{
        ...(variant === 'ghost' && {
          '&:hover': { backgroundColor: `${theme.palette.primary.main}08` },
        }),
      }}
    >
      {isUploading ? copy.uploading : label}
    </Button>
  );
}

/** The screen-reader live region — drag, progress and error announcements. */
function UploadAnnouncer({
  copy,
  announceDragOver,
  isUploading,
  progress,
  error,
}: {
  copy: UploadButtonCopy;
  announceDragOver: boolean;
  isUploading: boolean;
  progress: number;
  error: string | null;
}): React.ReactElement {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{
        position: 'absolute',
        left: '-10000px',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
    >
      {announceDragOver && copy.dropReady}
      {isUploading && copy.uploadInProgress(Math.round(progress))}
      {error && copy.errorAnnouncement(error)}
    </div>
  );
}

/** Progress bar, helper text, error text and the live region. */
export function UploadFeedback({
  copy,
  isUploading,
  progress,
  helperText,
  helperId,
  error,
  errorId,
  announceDragOver,
}: {
  copy: UploadButtonCopy;
  isUploading: boolean;
  progress: number;
  helperText?: string;
  helperId?: string;
  error: string | null;
  errorId?: string;
  announceDragOver: boolean;
}): React.ReactElement {
  return (
    <>
      {isUploading && progress > 0 && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: 1 }} />
          <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>
            {copy.percentUploaded(Math.round(progress))}
          </Typography>
        </Box>
      )}

      {helperText && !error && (
        <Typography
          id={helperId}
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5 }}
        >
          {helperText}
        </Typography>
      )}

      {error && (
        <Typography
          id={errorId}
          variant="caption"
          color="error"
          sx={{ display: 'block', mt: 0.5 }}
          role="alert"
        >
          {error}
        </Typography>
      )}

      <UploadAnnouncer
        copy={copy}
        announceDragOver={announceDragOver}
        isUploading={isUploading}
        progress={progress}
        error={error}
      />
    </>
  );
}
