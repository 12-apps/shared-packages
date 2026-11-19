import type { AccountDeletionCopy } from "./copy";

/** The deletion's refusals and mails, en-US. */
export const EN_US_ACCOUNT_DELETION: AccountDeletionCopy = {
  refusals: {
    wrongPassword: "Wrong password.",
    tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
    signInAgain: "Sign in with Google again to confirm.",
    blocked: "Settle the items above before deleting the account.",
    alreadyScheduled: "Your account's deletion is already scheduled.",
    notScheduled: "Your account has no deletion scheduled.",
    impersonating: "Only the person themselves can delete the account.",
  },
  mail: {
    scheduled: {
      subject: (date) => `Your account will be deleted on ${date}`,
      lead: (date) =>
        `We received your request to delete your account and signed you out on every device. Until ${date}, just sign in and tap Cancel deletion. If it was not you, sign in now and cancel.`,
      action: "Undo",
    },
    "week-before": {
      subject: (date) => `7 days left: your account will be deleted on ${date}`,
      lead: (date) => `Your account will be deleted on ${date}. If you changed your mind, sign in and tap Cancel deletion.`,
      action: "Cancel deletion",
    },
    "day-before": {
      subject: (date) => `Your account will be deleted within 24 hours (${date})`,
      lead: (date) =>
        `On ${date} your account will be deleted and it cannot be recovered afterwards. To keep using it, sign in today and tap Cancel deletion.`,
      action: "Cancel deletion",
    },
    cancelled: {
      subject: () => "Your account's deletion was cancelled",
      lead: () => "Your account is as it was. If you did not cancel it, change your password.",
      action: "Sign in",
    },
  },
};
