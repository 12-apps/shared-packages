import { useCallback, useRef, useState } from 'react';

import {
  messagesOf,
  rejectFileUpfront,
  transportFailure,
  uploadFailure,
  type WebStorageMessageContext,
  type WebStorageMessages,
} from './failures';
import { optimizeImage, type ImageProfile } from './optimize-image';
import {
  createSendMeter,
  defaultPrepareMs,
  estimateSendBytes,
  measuredUploadRate,
  preparingProgress,
  SAVING,
  SENDING_UNMEASURED,
  type UploadProgress,
} from './upload-progress';
import { sendWithFetch, sendWithXhr, uploadEndpoint, type SendOutcome } from './upload-request';

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
  /** Resolves the stored key, or `null` — after a failure (see `error`) or an `abort()`. */
  upload: (file: File, options?: UploadOptions) => Promise<string | null>;
  uploading: boolean;
  /**
   * Which wait the running upload is in, with whatever estimate is honest;
   * `null` when idle, and again on success, on every failure and on `abort()`.
   */
  progress: UploadProgress | null;
  /**
   * Cancel the running upload: the request is aborted (or the re-encode's result
   * dropped), `progress` returns to `null`, no `error` is set, and `upload()`
   * resolves `null`. A no-op when nothing runs.
   */
  abort: () => void;
  error: string | null;
  clearError: () => void;
}

/**
 * What a component that DRIVES an upload needs from the hook — the input type
 * for one (`ImageField`'s `uploader`). Narrower than {@link UploadState} on
 * purpose: a host passing its own uploader object keeps type-checking when the
 * hook grows a member.
 */
export type UploadDriver = Pick<UploadState, 'upload' | 'uploading' | 'error' | 'clearError'>;

export interface UseUploadConfig {
  /** Where the router is mounted, e.g. `/api`. */
  apiBase: string;
  /**
   * Query parameters appended to the endpoint, each URL-encoded — for a host
   * that scopes its uploads (`{ tenant: 'my-store' }` → `?tenant=my-store`).
   */
  query?: Record<string, string>;
  /** The ceiling the SERVER enforces. The check here is only an early refusal. */
  maxBytes: number;
  /** The browser-side re-encode profile. */
  profile?: ImageProfile;
  /**
   * How the request is made. Default: an `XMLHttpRequest`, which reports the
   * bytes sent. Given, it is used as-is, and `sending` carries no fraction.
   */
  fetchImpl?: typeof fetch;
  /** Makes the default transport's request. Tests drive a fake through it. */
  xhrFactory?: () => XMLHttpRequest;
  /**
   * How long the re-encode of `file` will take, in milliseconds. Default: its
   * size over `REENCODE_BYTES_PER_MS` (measured; see `./upload-progress`).
   */
  estimatePrepareMs?: (file: File) => number;
  /**
   * The sending rate to assume, in bytes per second, before any upload in this
   * page session has measured one. Default `null`: with neither,
   * `totalSecondsLeft` stays `null` and only a stage's own time is shown.
   */
  assumedBytesPerSecond?: number | null;
  /**
   * The refusal copy, as the host's own factory of the mount's ceiling —
   * REQUIRED (pt-BR hosts: `PT_BR_WEB_STORAGE_MESSAGES` from `./pt-BR`).
   */
  messages: (context: WebStorageMessageContext) => WebStorageMessages;
}

/** How often the `preparing` estimate is re-read while the re-encode runs. */
const PREPARING_TICK_MS = 200;

/** One call of `upload()`: what `abort()` reaches, and whether it has. */
interface UploadRun {
  aborted: boolean;
  controller: AbortController;
  /** Resolves when `abort()` is called, so a pending re-encode can be raced. */
  whenAborted: Promise<null>;
  cancelers: (() => void)[];
  setAborted: () => void;
}

function newRun(): UploadRun {
  let fire: () => void = () => undefined;
  const whenAborted = new Promise<null>((resolve) => {
    fire = () => resolve(null);
  });
  const run: UploadRun = {
    aborted: false,
    controller: new AbortController(),
    whenAborted,
    cancelers: [],
    setAborted: () => {
      run.aborted = true;
      run.controller.abort();
      for (const cancel of run.cancelers) cancel();
      fire();
    },
  };
  return run;
}

type SetProgress = (progress: UploadProgress | null) => void;

interface RunContext {
  config: UseUploadConfig;
  run: UploadRun;
  /** Writes `progress` only while this run is still the current one. */
  show: SetProgress;
}

function defaultXhr(): XMLHttpRequest | null {
  return typeof XMLHttpRequest === 'function' ? new XMLHttpRequest() : null;
}

function sendingRate(config: UseUploadConfig): number | null {
  return measuredUploadRate() ?? config.assumedBytesPerSecond ?? null;
}

/** The re-encode, with a ticking estimate, raced against `abort()`. */
async function prepare(ctx: RunContext, file: File, optimize: boolean): Promise<File | null> {
  if (!optimize) return file;
  const { config, run, show } = ctx;
  const estimateMs = (config.estimatePrepareMs ?? defaultPrepareMs)(file);
  const sendBytes = estimateSendBytes(file, true, config.profile);
  const startedAt = Date.now();
  const tick = () =>
    show(preparingProgress({ elapsedMs: Date.now() - startedAt, estimateMs, sendBytes, bytesPerSecond: sendingRate(config) }));
  tick();
  const timer = setInterval(tick, PREPARING_TICK_MS);
  run.cancelers.push(() => clearInterval(timer));
  try {
    return await Promise.race([optimizeImage(file, config.profile), run.whenAborted]);
  } finally {
    clearInterval(timer);
  }
}

/** The request, by whichever transport this config has. */
function transmit(ctx: RunContext, url: string, file: File): Promise<SendOutcome> {
  const { config, run, show } = ctx;
  const xhr = config.fetchImpl ? null : (config.xhrFactory ?? defaultXhr)();
  if (!xhr) {
    show(SENDING_UNMEASURED);
    return sendWithFetch(config.fetchImpl ?? fetch, url, file, run.controller.signal);
  }
  run.cancelers.push(() => xhr.abort());
  const meter = createSendMeter(Date.now());
  show(meter.sample(0, file.size, Date.now()));
  return sendWithXhr(xhr, url, file, {
    onProgress: (loaded, total) => show(meter.sample(loaded, total, Date.now())),
    onSent: () => {
      meter.finish(file.size, Date.now());
      show(SAVING);
    },
  });
}

/** The answer, read into a key or a SPECIFIC message. */
async function settle(
  config: UseUploadConfig,
  outcome: Exclude<SendOutcome, { kind: 'aborted' }>,
): Promise<{ key: string } | { message: string }> {
  if (outcome.kind === 'transport') return { message: transportFailure(config.messages) };
  const { response } = outcome;
  if (!response.ok) return { message: await uploadFailure(response, config.maxBytes, config.messages) };
  const payload = (await response.json()) as { data?: { imageKey?: string } };
  const key = payload.data?.imageKey;
  if (!key) return { message: messagesOf(config.maxBytes, config.messages).missing_key };
  return { key };
}

/** The whole upload; `null` with `message` set is a failure, `null` alone an abort. */
async function runUpload(
  ctx: RunContext,
  file: File,
  options: UploadOptions,
): Promise<{ key: string } | { message: string } | null> {
  const { config, run } = ctx;
  // Shrink FIRST, then validate — the order is the point (see
  // `rejectFileUpfront`). `optimizeImage` never throws and returns the original
  // when it cannot help, so the checks below still see a real file either way.
  const upright = await prepare(ctx, file, options.optimize !== false);
  if (!upright || run.aborted) return null;

  const upfront = rejectFileUpfront(upright, config.maxBytes, config.messages);
  if (upfront) return { message: upfront };

  const outcome = await transmit(ctx, uploadEndpoint(config.apiBase, config.query), upright);
  if (outcome.kind === 'aborted' || run.aborted) return null;
  return settle(config, outcome);
}

/**
 * `progress` follows the most recent upload. Two uploads from one hook may run at
 * once (a host with one hook for a list of photos), so `uploading` is true while
 * ANY runs and `abort()` cancels all of them.
 *
 * `upload`, `abort` and `clearError` keep ONE identity across renders: a host
 * puts them in effect dependencies and in its own callbacks (a card's Cancel
 * calls `abort`), and a new function every render would re-run those. The
 * latest `config` is read through a ref, so a host passing an inline object
 * still uploads with what it passed last.
 */
export function useUpload(config: UseUploadConfig): UploadState {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const runs = useRef<UploadRun[]>([]);
  const configRef = useRef(config);
  configRef.current = config;

  const end = useCallback((run: UploadRun): void => {
    if (!runs.current.includes(run)) return;
    const wasLatest = runs.current[runs.current.length - 1] === run;
    runs.current = runs.current.filter((other) => other !== run);
    if (wasLatest) setProgress(null);
    if (runs.current.length === 0) setUploading(false);
  }, []);

  const upload = useCallback(
    async (file: File, options: UploadOptions = {}): Promise<string | null> => {
      const current = configRef.current;
      const run = newRun();
      runs.current = [...runs.current, run];
      const show: SetProgress = (next) => {
        if (runs.current[runs.current.length - 1] === run) setProgress(next);
      };
      setUploading(true);
      setError(null);
      try {
        const result = await runUpload({ config: current, run, show }, file, options);
        if (!result || run.aborted) return null;
        if ('key' in result) return result.key;
        setError(result.message);
        return null;
      } catch {
        if (!run.aborted) setError(messagesOf(current.maxBytes, current.messages).upload_failed);
        return null;
      } finally {
        end(run);
      }
    },
    [end],
  );

  const abort = useCallback((): void => {
    // Idle: nothing to cancel, and the last failure's message stays where it is.
    if (runs.current.length === 0) return;
    for (const run of runs.current) run.setAborted();
    runs.current = [];
    setUploading(false);
    setProgress(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { upload, uploading, progress, abort, error, clearError };
}
