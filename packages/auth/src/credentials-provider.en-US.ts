import type { CredentialsProviderLabels } from "./credentials-provider";

/**
 * The en-US labels of the Credentials provider — what Auth.js's own sign-in
 * page shows, and what the provider falls back to when a host passes none.
 */
export const EN_US_CREDENTIALS_LABELS: CredentialsProviderLabels = {
  name: "Email and password",
  email: "Email",
  password: "Password",
};
