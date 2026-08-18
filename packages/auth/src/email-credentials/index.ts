import { toContext } from "./context";
import { authenticate, type AuthenticateInput } from "./authenticate";
import { resendVerification, signUp, verifyEmail, type SignUpInput } from "./signup";
import { hasPassword, requestPasswordReset, resetPassword, setPassword } from "./reset";
import type {
  AcknowledgeResult,
  AuthenticateResult,
  EmailAuthSettings,
  EmailCredentialsConfig,
  SignUpResult,
} from "./types";

/**
 * The e-mail + password half of `@12-apps/auth`, as one factory taking one
 * config object — the same shape as `createApiAuth` and `createWebAuth`, for
 * the same reason: nothing global, so two instances cannot interfere and a test
 * needs no reset hook.
 *
 * ```ts
 * const credentials = createEmailCredentials({ store, mailer, settings, appUrl });
 * ```
 *
 * ## What it does and does not own
 *
 * It owns the RULES — how a password is hashed, how long a link lives, what is
 * proof of an address, which failures are indistinguishable from which. It owns
 * no table (the store port is the host's), no copy (the mailer port is the
 * host's), and no HTTP (the results are values, and the host maps them to
 * status codes).
 *
 * That split is what lets the identical flow serve a Portuguese storefront and
 * an English back-office out of one implementation, and it is why the two
 * operator switches arrive as a resolver rather than as booleans read once: a
 * superadmin flips them in a browser and the next request already obeys.
 *
 * ## The flows
 *
 * | Call | For |
 * |---|---|
 * | `signUp` | create an account with a password |
 * | `verifyEmail` | spend the link from the verification mail |
 * | `resendVerification` | send that link again |
 * | `requestPasswordReset` | "I forgot my password" |
 * | `resetPassword` | spend the link and choose a new one |
 * | `setPassword` | signed in: change one, or **add the first one to a Google account** |
 * | `hasPassword` | which of those two the security screen should offer |
 * | `authenticate` | check an e-mail and a password at sign-in |
 * | `readSettings` | what the login screen should render |
 */
export interface EmailCredentials {
  signUp(input: SignUpInput): Promise<SignUpResult>;
  verifyEmail(token: string): Promise<AcknowledgeResult>;
  resendVerification(email: string): Promise<AcknowledgeResult>;
  requestPasswordReset(email: string): Promise<AcknowledgeResult>;
  resetPassword(input: { token: string; password: string }): Promise<AcknowledgeResult>;
  setPassword(input: {
    userId: string;
    password: string;
    currentPassword?: string;
  }): Promise<AcknowledgeResult>;
  hasPassword(userId: string): Promise<boolean>;
  authenticate(input: AuthenticateInput): Promise<AuthenticateResult>;
  /** The live operator switches — what a login screen renders itself from. */
  readSettings(): Promise<EmailAuthSettings>;
}

/** Build the e-mail + password flow. One call, one config object. */
export function createEmailCredentials(
  config: EmailCredentialsConfig,
): EmailCredentials {
  const ctx = toContext(config);
  return {
    signUp: (input) => signUp(ctx, input),
    verifyEmail: (token) => verifyEmail(ctx, token),
    resendVerification: (email) => resendVerification(ctx, email),
    requestPasswordReset: (email) => requestPasswordReset(ctx, email),
    resetPassword: (input) => resetPassword(ctx, input),
    setPassword: (input) => setPassword(ctx, input),
    hasPassword: (userId) => hasPassword(ctx, userId),
    authenticate: (input) => authenticate(ctx, input),
    readSettings: () => ctx.readSettings(),
  };
}

export type { AuthenticateInput } from "./authenticate";
export type { SignUpInput } from "./signup";
export type {
  AcknowledgeResult,
  AuthEmailMessage,
  AuthRateLimiter,
  AuthTokenPurpose,
  AuthenticateResult,
  EmailAuthFailure,
  EmailAuthRefusal,
  EmailAuthSettings,
  EmailAuthSettingsResolver,
  EmailCredentialUser,
  EmailCredentialsConfig,
  EmailCredentialsMailer,
  EmailCredentialsStore,
  SignUpResult,
  StoredAuthToken,
} from "./types";
