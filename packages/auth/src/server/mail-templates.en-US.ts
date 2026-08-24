import type { MailPack } from "./mail-templates";

/** US English. The second pack. */
export const EN_US_MAIL: MailPack = {
  fallbackHint: "If the button does not work, copy and paste this address into your browser:",
  // Each locale owns its own plural rule, which is the whole reason this is a
  // function rather than a template: "1 hour" / "2 hours" and "24 hours" /
  // "2 days" inflect differently in the two languages, and a shared format
  // string would be wrong in one of them.
  validFor: (hours) => {
    if (hours >= 24) {
      const days = Math.round(hours / 24);
      return days === 1 ? "24 hours" : `${days} days`;
    }
    return hours === 1 ? "1 hour" : `${hours} hours`;
  },
  verification: {
    subject: "Confirm your e-mail address",
    greeting: (name) => (name?.trim() ? `Hello, ${name.trim()}` : "Hello"),
    lead: ({ validFor }) =>
      `Confirm your e-mail address to activate your account. The link lasts ${validFor} and can be used once.`,
    cta: "Confirm my e-mail address",
    footer: "If this was not you, you can safely ignore this message.",
  },
  passwordReset: {
    subject: "Reset your password",
    greeting: (name) => (name?.trim() ? `Hello, ${name.trim()}` : "Hello"),
    lead: ({ validFor }) =>
      `You asked to reset your password. The link lasts ${validFor} and can be used once.`,
    cta: "Set a new password",
    footer:
      "If this was not you, you can safely ignore this message. Your current password still works.",
  },
  alreadyRegistered: {
    subject: "You already have an account",
    greeting: (name) => (name?.trim() ? `Hello, ${name.trim()}` : "Hello"),
    /**
     * The link in THIS message is a RESET link, not a sign-in one — see
     * `signup.ts`: the overwhelmingly common cause is a returning user who
     * forgot they had an account, and the second most common is one who forgot
     * the password. So it words a lifetime like the other token mails, and its
     * button says what the button actually does. Calling it "Sign in" would
     * send somebody to a choose-a-new-password form expecting a sign-in.
     */
    lead: ({ validFor }) =>
      `Somebody tried to create an account with this e-mail address, and you already have one. If that was you, just sign in — or use the link below to set a new password. It lasts ${validFor}.`,
    cta: "Set a new password",
    footer:
      "If this was not you, you can safely ignore this message. No new account was created.",
  },
  passwordChanged: {
    subject: "Your password was changed",
    greeting: (name) => (name?.trim() ? `Hello, ${name.trim()}` : "Hello"),
    lead: () => "Your password was changed a moment ago. If that was you, there is nothing to do.",
    cta: "Sign in",
    // The one mail here that asks for ACTION on the negative branch, and the
    // emphasis is load-bearing: whoever made the change may hold the account.
    footer:
      "If this was NOT you, ask for a new password immediately — whoever made the change may have access to your account.",
  },
};
