import type { FeatureFlagsServerCopy } from "./copy";

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`copy: EN_US_FEATURE_FLAGS_SERVER_COPY`), never a default. The filename is
 * what exempts this file from the copy-portability gate, as `pt-BR.ts` beside
 * it is exempt.
 */
export const EN_US_FEATURE_FLAGS_SERVER_COPY: FeatureFlagsServerCopy = {
  unauthenticated: "Not authenticated.",
  invalidUser: "Name the user.",
  invalidEmail: "Enter a valid e-mail address.",
  noteTooLong: "That note is too long.",
  userNotFound: "No user with that e-mail address.",
  invalidBody: "Invalid body.",
  grantNotFound: "That user does not have access to this feature.",
  unknownFlag: "Unknown feature.",
  invalidEnabled: "The enabled field must be a boolean.",
};
