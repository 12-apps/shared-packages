import type { OnboardingMessages } from "./context";

/**
 * The en-US pack — the same three route answers for an English-reading
 * audience, plus the 401 body. The filename is what exempts this file from the
 * copy-portability gate, as `pt-BR.ts` beside it is exempt.
 */
export const EN_US_ONBOARDING_MESSAGES: OnboardingMessages = {
  resetUnavailable: "Onboarding reset is unavailable in production.",
  invalidOperation: "Invalid onboarding operation.",
  unknownFeature: "Unknown onboarding feature.",
};

/** The 401 the mounted router answers when the host resolves no actor. */
export const EN_US_ONBOARDING_UNAUTHENTICATED = "Not authenticated.";
