import Box from '@mui/material/Box';
import React from 'react';

import { useUploadButton } from './UploadButton.hooks';
import {
  UploadDropzone,
  UploadFeedback,
  UploadTrigger,
  type TriggerProps,
} from './UploadButton.parts';
import type { UploadButtonProps, UploadButtonState } from './UploadButton.types';

/**
 * A file picker with an optional drag-and-drop surface.
 *
 * The body here is deliberately thin: selection rules live in
 * `UploadButton.hooks`, appearance in `UploadButton.parts`. What remains is the
 * wiring — the hidden input, which trigger to render, and the feedback beneath.
 */
const UploadButton = React.forwardRef<HTMLInputElement, UploadButtonProps>((props, ref) => {
  const {
    copy,
    variant = 'default',
    label = props.copy.buttonLabel,
    disabled = false,
    multiple = false,
    accept,
    capture,
    helperText,
    icon,
    className,
    'data-testid': dataTestId,
  } = props;
  const { inputRef, inputId, state, drag, derived, openPicker, handleInputChange } =
    useUploadButton(props);

  const trigger: TriggerProps = {
    copy,
    label,
    icon,
    disabled,
    className,
    dataTestId,
    describedBy: derived.describedBy,
    onOpen: openPicker,
  };

  return (
    <Box>
      <input
        ref={ref || inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        onChange={handleInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
        aria-hidden="true"
      />

      {variant === 'dropzone' ? (
        <UploadDropzone {...trigger} isDragOver={state.isDragOver} drag={drag} />
      ) : (
        <UploadTrigger {...trigger} variant={variant} isUploading={derived.isUploading} />
      )}

      <UploadFeedback
        copy={copy}
        isUploading={derived.isUploading}
        progress={derived.progress}
        helperText={helperText}
        helperId={derived.helperId}
        error={derived.error}
        errorId={derived.errorId}
        announceDragOver={variant === 'dropzone' && state.isDragOver}
      />
    </Box>
  );
});

UploadButton.displayName = 'UploadButton';

export { UploadButton };
export type { UploadButtonProps, UploadButtonState };
