import { useState } from 'react';

import { STORAGE_PATHS } from '../paths';
import {
  messagesOf,
  rejectFileUpfront,
  transportFailure,
  uploadFailure,
  type WebStorageMessages,
} from './failures';
import { optimizeImage, type ImageProfile } from './optimize-image';

/**
 * Storing an image from the browser: ONE request, to the package's own endpoint,
 * which answers with the key to save.
 *
 * It is one request rather than two — and never a presigned bucket URL — for the
 * reasons the root entry states at length: a key minted before the bytes exist has
 * to PREDICT whether crops will accompany it, and a cross-origin PUT fails
 * invisibly server-side and unfixably for the store owner. Neither is a trade this
 * hook is allowed to reopen; there is no `presign` option.
 *
 * Every exit path that returns `null` sets a SPECIFIC `error` first — the file was
 * too big, the session expired, the server could not read the image, the
 * connection never landed. That is the difference between an owner who can fix
 * their upload (or hand support a real symptom) and one staring at a red box that
 * says only that something went wrong.
 */

/** Per-call knobs. Everything else about an upload is the same every time. */
export interface UploadOptions {
  /**
   * Re-encode and downscale before sending (default `true`).
   *
   * Turned OFF for files that are not a picked photo — an app icon rendered to
   * exactly 192 and 512 px, say, whose manifest declares `image/png` in a literal.
   * Quietly handing that a WebP makes the manifest describe an asset that does not
   * exist, and takes the app's installability with it.
   */
  optimize?: boolean;
}

export interface UploadState {
  upload: (file: File, options?: UploadOptions) => Promise<string | null>;
  uploading: boolean;
  error: string | null;
  clearError: () => void;
}

export interface UseUploadConfig {
  /** Where the router is mounted, e.g. `/api`. */
  apiBase: string;
  /** The ceiling the SERVER enforces. The check here is only an early refusal. */
  maxBytes: number;
  /** The browser-side re-encode profile. */
  profile?: ImageProfile;
  /** How the request is made. Default: same-origin `fetch`. */
  fetchImpl?: typeof fetch;
  /** pt-BR refusal copy overrides, for the codes only the host can explain. */
  messages?: Partial<WebStorageMessages>;
}

export function useUpload(config: UseUploadConfig): UploadState {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `${config.apiBase.replace(/\/$/, '')}${STORAGE_PATHS.upload}`;

  async function send(file: File): Promise<string | null> {
    const request = config.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await request(endpoint, {
        method: 'POST',
        // The raw file, not base64 or multipart: the server reads the bytes
        // straight off the stream against its own cap, and the type it stores the
        // object as is this header.
        headers: { 'content-type': file.type },
        body: file,
      });
    } catch {
      setError(transportFailure(config.messages));
      return null;
    }
    if (!response.ok) {
      setError(await uploadFailure(response, config.maxBytes, config.messages));
      return null;
    }
    const payload = (await response.json()) as { data?: { imageKey?: string } };
    const key = payload.data?.imageKey;
    if (!key) {
      setError(messagesOf(config.maxBytes, config.messages).missing_key);
      return null;
    }
    return key;
  }

  async function upload(file: File, options: UploadOptions = {}): Promise<string | null> {
    setUploading(true);
    setError(null);
    try {
      // Shrink FIRST, then validate — the order is the point (see
      // `rejectFileUpfront`). `optimizeImage` never throws and returns the original
      // when it cannot help, so the checks below still see a real file either way.
      const upright =
        options.optimize === false ? file : await optimizeImage(file, config.profile);

      const upfront = rejectFileUpfront(upright, config.maxBytes, config.messages);
      if (upfront) {
        setError(upfront);
        return null;
      }
      return await send(upright);
    } catch {
      setError(messagesOf(config.maxBytes, config.messages).upload_failed);
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error, clearError: () => setError(null) };
}
