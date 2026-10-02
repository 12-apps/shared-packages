/**
 * Every string the thread SCREEN renders — required host config, no defaults.
 * Role labels are not here: they come from the server, which got them from the
 * host's role config, so every surface shows the same name for a role.
 */
export interface ChatUiCopy {
  /** The composer's placeholder. */
  readonly placeholder: string;
  readonly send: string;
  /** Shown on the send button while a message is in flight. */
  readonly sending: string;
  /** No message yet. */
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  /** Read-only notice when the caller may no longer write. */
  readonly closed: string;
  /** First load failed. */
  readonly loadError: string;
  readonly retry: string;
  /** Heading over the quick replies. */
  readonly quickReplies: string;
  /** A send failed with no sentence from the server (no connection). */
  readonly sendFailed: string;
  /** Shown while the first load is in flight. */
  readonly loading: string;
}

export const UI_COPY_KEYS: readonly (keyof ChatUiCopy)[] = [
  "placeholder",
  "send",
  "sending",
  "emptyTitle",
  "emptyDescription",
  "closed",
  "loadError",
  "retry",
  "quickReplies",
  "sendFailed",
  "loading",
];
