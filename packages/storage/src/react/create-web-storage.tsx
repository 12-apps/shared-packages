import { useState, type ComponentType, type JSX } from 'react';

import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { DEFAULT_MAX_UPLOAD_BYTES, megabytes } from '../limits';
import type { WebStorageMessageContext, WebStorageMessages } from './failures';
import { ImageField, type ImageFieldProps } from './image-field';
import type { ImageProfile } from './optimize-image';
import { useUpload, type UploadState, type UseUploadConfig } from './use-upload';

/**
 * The one thing this package exposes to a FRONTEND host.
 *
 * Everything the upload IS lives inside: the browser-side re-encode, the upfront
 * refusals, the single same-origin POST, the failure vocabulary, the picker and its
 * preview. The host names where the API is mounted, and that is the whole wiring.
 *
 * `maxBytes` defaults to {@link DEFAULT_MAX_UPLOAD_BYTES} — the same constant the
 * backend mount is meant to be given — so the two agree by construction unless a
 * host deliberately diverges. It is only an EARLY refusal in any case: the server
 * is the authority, and the copy the browser shows is generated from whatever
 * number it was handed, so it cannot claim a limit it is not applying.
 */

export interface WebStorageConfig {
  /** Where the router is mounted, e.g. `/api`. */
  apiBase: string;
  /** The ceiling the server enforces. Default {@link DEFAULT_MAX_UPLOAD_BYTES}. */
  maxBytes?: number;
  /** The browser-side re-encode profile. */
  profile?: ImageProfile;
  /** How requests are made. Default: same-origin `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Every sentence this surface renders — REQUIRED, the host's own factory of
   * the mount's ceiling, mirroring the server mount's `messages` (pt-BR
   * hosts: `PT_BR_WEB_STORAGE_MESSAGES` from `./pt-BR`). Write `forbidden` to
   * name YOUR reason: the package states only that the account may not
   * upload, because `mayUpload` is one host-computed boolean and a package
   * that named a role model would be wrong for every host but the first.
   */
  messages: (context: WebStorageMessageContext) => WebStorageMessages;
}

export interface WebStorage {
  /** A standalone upload surface — the whole thing, ready to render. */
  page: ComponentType;
  /** The field a form drops in: picker, preview, refusal, and a key out. */
  ImageField: ComponentType<ImageFieldProps>;
  /** The primitive, for a host composing its own affordance. */
  useUpload: () => UploadState;
  /** What this surface enforces before a request leaves the browser. */
  limits: { maxBytes: number; maxBytesLabel: string };
}

export function createWebStorage(config: WebStorageConfig): WebStorage {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const uploadConfig: UseUploadConfig = {
    apiBase: config.apiBase,
    maxBytes,
    ...(config.profile ? { profile: config.profile } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    messages: config.messages,
  };
  const useBoundUpload = (): UploadState => useUpload(uploadConfig);

  function BoundImageField(props: ImageFieldProps): JSX.Element {
    return <ImageField {...props} uploader={useBoundUpload()} />;
  }

  /**
   * The standalone surface: pick a file, see the key it was stored under. It is
   * what a host mounts to prove the wiring end to end, and what the consumer
   * harness drives — the key on screen is the same string a form would save.
   */
  function UploadPage(): JSX.Element {
    const [imageKey, setImageKey] = useState<string | null>(null);
    const messages = config.messages({ limit: megabytes(maxBytes) });
    return (
      <Stack spacing={2} data-testid="storage-upload-page">
        <Text as="h2">{messages.pageTitle}</Text>
        <Text as="p">{messages.pageIntro}</Text>
        <BoundImageField
          value={imageKey}
          onChange={setImageKey}
          label={messages.fieldLabel}
          removeLabel={messages.fieldRemove}
          uploadCopy={messages.field}
          helperText={messages.fieldHelper}
        />
      </Stack>
    );
  }

  return {
    page: UploadPage,
    ImageField: BoundImageField,
    useUpload: useBoundUpload,
    limits: { maxBytes, maxBytesLabel: megabytes(maxBytes) },
  };
}
