import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import { Button } from '@12-apps/ui/form/Button';
import { UploadButton } from '@12-apps/ui/form/UploadButton';

import { ACCEPTED_CONTENT_TYPES } from '../content-types';
import type { UploadOptions, UploadState } from './use-upload';

/**
 * The picker, the preview and the refusal, as one field.
 *
 * `@12-apps/ui/form/UploadButton` is the presentation and this is the BINDING: it
 * owns the three things a form gets wrong when it wires an upload by hand.
 *
 *   1. **The preview appears the moment the file is PICKED**, not when the upload
 *      lands. An empty slot during the round-trip reads as "the click did nothing",
 *      which is exactly how a swallowed storage 503 looked. A failure withdraws it
 *      and `error` says why.
 *   2. **A failed upload restores the previous preview.** Leaving the new one up
 *      would show a photo that is not saved and will not be.
 *   3. **The saved key is the only output.** A form folds `imageKey` into its save
 *      payload; it never learns a URL, because only the server knows which driver
 *      is running and where a CDN points.
 */

export interface ImageFieldProps {
  /** The key already saved on the row, if any. */
  value?: string | null;
  /** A URL for the saved key — the server resolved it through the driver. */
  previewUrl?: string | null;
  /** Called with the new key, or `null` when the image is removed. */
  onChange: (imageKey: string | null) => void;
  /** The dropzone's own label. REQUIRED — this package ships no default copy. */
  label: string;
  /** The button that clears a chosen image. REQUIRED, for the same reason. */
  removeLabel: string;
  helperText?: string;
  /** Passed through per upload — `{ optimize: false }` for a rendered canvas. */
  uploadOptions?: UploadOptions;
  disabled?: boolean;
  'data-testid'?: string;
}

/** {@link ImageFieldProps} plus the bound upload state the factory injects. */
export interface BoundImageFieldProps extends ImageFieldProps {
  uploader: UploadState;
}

const ACCEPT = ACCEPTED_CONTENT_TYPES.join(',');

export function ImageField(props: BoundImageFieldProps): JSX.Element {
  const { uploader } = props;
  const [preview, setPreview] = useState<string | null>(props.previewUrl ?? null);
  const testId = props['data-testid'] ?? 'storage-image-field';

  async function handleSelect(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    const previous = preview;
    setPreview(objectUrl);
    const key = await uploader.upload(file, props.uploadOptions);
    if (key) {
      props.onChange(key);
      return;
    }
    URL.revokeObjectURL(objectUrl);
    setPreview(previous);
  }

  function handleRemove(): void {
    setPreview(null);
    uploader.clearError();
    props.onChange(null);
  }

  return (
    <Stack spacing={1} data-testid={testId}>
      {preview ? (
        <Box>
          {/* A plain <img>: a package cannot assume a framework's image
              component, and this preview is a local blob half the time. */}
          <img
            src={preview}
            alt={props.label ?? 'Imagem'}
            data-testid={`${testId}-preview`}
            style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain' }}
          />
        </Box>
      ) : null}
      <UploadButton
        variant="dropzone"
        label={props.label}
        accept={ACCEPT}
        disabled={props.disabled || uploader.uploading}
        uploading={uploader.uploading}
        helperText={props.helperText}
        onSelect={(file) => void handleSelect(file)}
        data-testid={`${testId}-picker`}
      />
      {preview ? (
        <Box>
          <Button variant="text" onClick={handleRemove} dataTestId={`${testId}-remove`}>
            {props.removeLabel}
          </Button>
        </Box>
      ) : null}
      {uploader.error ? (
        <Alert variant="danger" data-testid={`${testId}-error`}>
          {uploader.error}
        </Alert>
      ) : null}
      {props.value ? (
        <Text as="p" data-testid={`${testId}-key`}>
          {props.value}
        </Text>
      ) : null}
    </Stack>
  );
}
