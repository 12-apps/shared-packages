/**
 * The shape of an upload's progress, stated STRUCTURALLY: it is what
 * `@12-apps/storage/react`'s `useUpload` returns as `progress`, but this
 * package imports nothing from storage — any source of the same three stages
 * fits.
 */
export type UploadProgressStage = 'preparing' | 'sending' | 'saving';

export interface UploadProgressValue {
  stage: UploadProgressStage;
  /** 0–1 through the stage, or `null` when it cannot be measured (a spinner stands in). */
  fraction: number | null;
  /** Seconds left in the stage, or `null` when there is no honest estimate. */
  secondsLeft: number | null;
  /** Which of the three stages this is (`preparing` 1, `sending` 2, `saving` 3). */
  step?: number;
  /** Seconds left until the bytes are up, when a sending rate is known. */
  totalSecondsLeft?: number | null;
}

/** Every word the component renders. REQUIRED — this package ships none. */
export interface UploadProgressCopy {
  /** The re-encode's stage word: "Adjusting the photo". */
  preparing: string;
  /** The bytes' stage word: "Sending photo". */
  sending: string;
  /** The server's stage word, shown with a spinner: "Photo sent, saving…". */
  saving: string;
  /** Which stage of how many: `(1, 3)` → "1 of 3". */
  step: (n: number, of: number) => string;
  /** This stage's time left, already rounded up: `5` → "About 5 s left". */
  secondsLeft: (n: number) => string;
  /** Time left until the bytes are up: `7` → "About 7 s left in all". */
  totalSecondsLeft: (n: number) => string;
  /** The percentage, already rounded: `62` → "62%". */
  percent: (n: number) => string;
}

export interface UploadProgressProps {
  /**
   * The upload's progress; `null` (idle, done or failed) draws nothing but keeps
   * the empty live region mounted, so the next upload's first stage is announced.
   */
  progress: UploadProgressValue | null;
  copy: UploadProgressCopy;
  /**
   * `regular` (default): the stage word, the bar, the percentage or step, and
   * the time left under it. `compact`, for a small thumbnail: the bar alone
   * (the stage word is still announced) — a caller with room beside it shows
   * the time with {@link useUploadTimeLeft}.
   */
  size?: 'regular' | 'compact';
  dataTestId?: string;
}

/** How many stages an upload has; `step` counts out of this. */
export const UPLOAD_STAGE_COUNT = 3;
