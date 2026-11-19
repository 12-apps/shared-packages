import type { AccountDeletionScreenCopy } from "./copy";

/** The deletion screen's en-US pack. */
export const EN_US_ACCOUNT_DELETION_SCREEN: AccountDeletionScreenCopy = {
  title: "Delete account",
  settleFirst: "First, settle:",
  forfeitTitle: "You lose:",
  passwordLabel: "Your password",
  googleLead: "Your account signs in with Google. To confirm, sign in with Google again.",
  googleAction: "Sign in with Google",
  googleFresh: "You just signed in with Google.",
  when: (date) => `Signed out now; deleted on ${date}. Until then, sign in to change your mind.`,
  irreversible: (days) => `After ${days} days, it cannot be undone.`,
  submit: "Delete my account",
  failed: "Could not delete right now. Try again.",
  loadFailed: "Could not load. Try again.",
  retry: "Try again",
  alreadyPending: "Your account's deletion is already scheduled.",
  pendingTitle: (date) => `Your account will be deleted on ${date}`,
  pendingBody: "Your data is still here. Want to keep using it?",
  pendingCancel: "Cancel deletion",
  pendingSignOut: "Sign out",
};
