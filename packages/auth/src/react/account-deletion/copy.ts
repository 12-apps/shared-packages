/**
 * The screen's words: the package's own packs, as the other auth screens'.
 * What goes and what stays is NOT here — it is a promise about the host's own
 * data, so the host passes it (`facts` on the web config).
 */
export interface AccountDeletionScreenCopy {
  readonly title: string;
  readonly settleFirst: string;
  readonly forfeitTitle: string;
  readonly passwordLabel: string;
  readonly googleLead: string;
  readonly googleAction: string;
  readonly googleFresh: string;
  readonly when: (date: string) => string;
  readonly irreversible: (days: number) => string;
  readonly submit: string;
  readonly failed: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly alreadyPending: string;
  readonly pendingTitle: (date: string) => string;
  readonly pendingBody: string;
  readonly pendingCancel: string;
  readonly pendingSignOut: string;
}
