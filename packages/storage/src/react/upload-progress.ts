import { CATALOG_IMAGE_PROFILE, type ImageProfile } from './optimize-image';

/**
 * What an upload is doing right now, in the three waits a person sits through:
 * the browser re-encoding the photo (`preparing`), the bytes going up
 * (`sending`), and the server cutting its crops before it answers (`saving`).
 *
 * Every number here is an ESTIMATE the caller may show, or `null` where there is
 * no honest one — and `null` is the common case on purpose: a bar that guesses
 * reads as broken the moment the guess is wrong, a spinner never does.
 */
export type UploadStage = 'preparing' | 'sending' | 'saving';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–1 through this stage, or `null` when it cannot be measured (spinner). */
  fraction: number | null;
  /** Seconds left in this stage, or `null` when there is no honest estimate yet. */
  secondsLeft: number | null;
  /** Which of the three stages this is: `preparing` 1, `sending` 2, `saving` 3. */
  step: 1 | 2 | 3;
  /**
   * Seconds left until the bytes are up: this stage's rest plus the sending
   * estimate. `null` whenever no sending rate is known — neither measured by an
   * earlier upload in this page session nor assumed by the host.
   */
  totalSecondsLeft: number | null;
}

/**
 * How fast a browser re-encodes a picked photo, in bytes of the ORIGINAL file per
 * millisecond: the default `estimatePrepareMs` is `file.size / REENCODE_BYTES_PER_MS`.
 *
 * Measured (2026-11-09): the `optimizeImage` pipeline (`createImageBitmap` →
 * a 1280 px canvas → WebP 0.82) on camera-sized JPEGs — 4.0 MB and 6.7 MB at
 * 12 MP, 15.6 MB at 48 MP, three runs each — in headless Chromium under a 4×
 * CPU slowdown, the factor Lighthouse's mobile preset uses to stand for a
 * mid-range phone. The runs landed between 7,900 and 19,100 bytes/ms, the
 * smallest file slowest (decode cost follows pixels more than bytes). The
 * slowdown reaches the page's main thread but not the decoder's own thread,
 * so those times are a floor; the constant takes HALF the slowest run, so the
 * bar reaches its 95 % ceiling a little late rather than stalling there early.
 * A 12 MB phone photo reads as ~3 s. A host with its own numbers passes
 * `estimatePrepareMs`.
 */
export const REENCODE_BYTES_PER_MS = 4_000;

/** `preparing` never claims to be done until the re-encode actually returns. */
export const PREPARING_FRACTION_CAP = 0.95;

/**
 * What a re-encoded photo weighs, per pixel of the profile's box: in the same
 * measurement, WebP at 0.82 came out at 0.16–0.17 bytes per pixel of a
 * 1280 × 960 output. Rounded up, because it only predicts the SENDING time
 * while the re-encode still runs, when the real output size is unknown.
 */
const ENCODED_BYTES_PER_PIXEL = 0.2;

/** A 4:3 photo is the common case the box is filled by. */
const TYPICAL_ASPECT = 3 / 4;

/** The measuring window `secondsLeft` waits for before it says anything. */
const MEASURE_MIN_MS = 500;
const MEASURE_MIN_FRACTION = 0.1;

/** Weight of the newest sample in the smoothed sending rate. */
const RATE_SMOOTHING = 0.3;

export function defaultPrepareMs(file: File): number {
  return file.size / REENCODE_BYTES_PER_MS;
}

/** The bytes the request will carry, guessed before the re-encode has produced them. */
export function estimateSendBytes(
  file: File,
  optimize: boolean,
  profile: ImageProfile = CATALOG_IMAGE_PROFILE,
): number {
  if (!optimize) return file.size;
  const encoded = profile.maxEdge * profile.maxEdge * TYPICAL_ASPECT * ENCODED_BYTES_PER_PIXEL;
  return Math.min(file.size, Math.round(encoded));
}

/**
 * The sending rate an earlier upload in this page session measured, in bytes per
 * second. Module state on purpose: it is the same connection for every field on
 * the page, and the first upload of a session is exactly the one with no number.
 */
let sessionBytesPerSecond: number | null = null;

export function measuredUploadRate(): number | null {
  return sessionBytesPerSecond;
}

export function recordUploadRate(bytes: number, milliseconds: number): void {
  if (bytes > 0 && milliseconds > 0) sessionBytesPerSecond = (bytes / milliseconds) * 1000;
}

/** Forget the measured rate. Tests, and a host that knows the network changed. */
export function resetMeasuredUploadRate(): void {
  sessionBytesPerSecond = null;
}

function secondsFor(bytes: number, bytesPerSecond: number | null): number | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;
  return bytes / bytesPerSecond;
}

export interface PreparingInput {
  elapsedMs: number;
  estimateMs: number;
  sendBytes: number;
  bytesPerSecond: number | null;
}

export function preparingProgress(input: PreparingInput): UploadProgress {
  const { elapsedMs, estimateMs, sendBytes, bytesPerSecond } = input;
  const known = estimateMs > 0;
  const fraction = known ? Math.min(PREPARING_FRACTION_CAP, elapsedMs / estimateMs) : null;
  // Past its own estimate the stage has nothing honest left to say about itself.
  const restMs = known ? estimateMs - elapsedMs : 0;
  const secondsLeft = restMs > 0 ? restMs / 1000 : null;
  const sending = secondsFor(sendBytes, bytesPerSecond);
  return {
    stage: 'preparing',
    fraction,
    secondsLeft,
    step: 1,
    totalSecondsLeft: sending === null ? null : (secondsLeft ?? 0) + sending,
  };
}

/** `sending` when nothing reports bytes (a host's `fetchImpl`): a spinner, no number. */
export const SENDING_UNMEASURED: UploadProgress = {
  stage: 'sending',
  fraction: null,
  secondsLeft: null,
  step: 2,
  totalSecondsLeft: null,
};

export const SAVING: UploadProgress = {
  stage: 'saving',
  fraction: null,
  secondsLeft: null,
  step: 3,
  totalSecondsLeft: null,
};

/**
 * The sending rate, smoothed: an exponential average of the per-event rates,
 * seeded with the cumulative one, so a single burst (the socket buffer filling
 * in the first event) never becomes the time a person reads.
 */
export interface SendMeter {
  sample: (loaded: number, total: number, now: number) => UploadProgress;
  /** Bytes per second over the whole send, for the next upload's estimate — only from a send that lasted the measuring window. */
  finish: (total: number, now: number) => void;
}

export function createSendMeter(startedAt: number): SendMeter {
  let rate: number | null = null;
  let last = { loaded: 0, at: startedAt };

  function update(loaded: number, now: number): void {
    const dt = now - last.at;
    if (dt <= 0) return;
    const instant = ((loaded - last.loaded) / dt) * 1000;
    rate = rate === null ? (loaded / (now - startedAt)) * 1000 : RATE_SMOOTHING * instant + (1 - RATE_SMOOTHING) * rate;
    last = { loaded, at: now };
  }

  return {
    sample(loaded, total, now) {
      update(loaded, now);
      const fraction = total > 0 ? Math.min(1, loaded / total) : null;
      const measured = now - startedAt >= MEASURE_MIN_MS || (fraction ?? 0) >= MEASURE_MIN_FRACTION;
      // No total, no estimate: a rate says nothing about bytes nobody counted.
      const secondsLeft = fraction !== null && measured && rate ? secondsFor(Math.max(0, total - loaded), rate) : null;
      return { stage: 'sending', fraction, secondsLeft, step: 2, totalSecondsLeft: secondsLeft };
    },
    finish(total, now) {
      // A send shorter than the measuring window is a buffer filling (a
      // proxy, the socket), not the network: it would teach the next upload
      // a rate it will never see.
      if (now - startedAt >= MEASURE_MIN_MS) recordUploadRate(total, now - startedAt);
    },
  };
}
