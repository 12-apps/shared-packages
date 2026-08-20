import Credentials from "@auth/core/providers/credentials";
import { CredentialsSignin } from "@auth/core/errors";
import type { Provider } from "@auth/core/providers";
import type { User } from "@auth/core/types";

import { CREDENTIALS_PROVIDER_ID } from "./credentials-provider-id";
import type { AuthenticateResult, EmailAuthFailure } from "./email-credentials/types";

/**
 * The bridge between {@link createEmailCredentials} and Auth.js: an
 * `@auth/core` Credentials provider whose `authorize` is the flow's
 * `authenticate`.
 *
 * ## Why a provider at all
 *
 * Auth.js can only mint a session DURING one of its own actions. There is no
 * "log this person in" function to call after checking a password yourself —
 * so a password sign-in has to arrive as a provider, or the host ends up
 * hand-rolling a second session cookie beside the one Auth.js issues, and then
 * owning the difference between them forever.
 *
 * Routing it through the provider also means a password sign-in passes the
 * host's `signInGate` and lands in the same `jwt`/`session` callbacks as a
 * Google one, so `session.user.isSuperadmin` and the terms gate work on it
 * without a single extra line in the host.
 *
 * ## Why the refusal reason survives
 *
 * `authorize` returning `null` collapses every failure into one opaque
 * `CredentialsSignin`, which reaches the user as "sign-in failed" — including
 * the one case that is actionable, "your address is not verified yet, check
 * your inbox". Throwing a {@link CredentialsSignin} with a `code` keeps the
 * distinction: Auth.js puts the code on the redirect URL, and the browser half
 * reads it back and shows the right thing.
 *
 * The codes that survive are only the ones safe to say out loud. Everything
 * that could distinguish "no such account" from "wrong password" is already
 * collapsed to `invalid-credentials` by `authenticate` itself, before it gets
 * here — see that file for why.
 */

// The id is NOT re-exported here. It has its own pure module and the package
// ROOT exports it from there, so a browser comparing `session.provider` can
// have the string without pulling `@auth/core` in behind it — which is the
// whole reason the id was split out in the first place.

/** An Auth.js error carrying the flow's refusal reason as its `code`. */
class EmailPasswordSignin extends CredentialsSignin {
  constructor(reason: EmailAuthFailure) {
    super(reason);
    this.code = reason;
  }
}

export interface CredentialsProviderConfig {
  /** The flow's `authenticate`, or anything with the same shape. */
  authenticate: (input: {
    email: string;
    password: string;
  }) => Promise<AuthenticateResult>;
  /** Provider id. Defaults to {@link CREDENTIALS_PROVIDER_ID}. */
  id?: string;
  /** Human label, for hosts that render Auth.js's own sign-in page. */
  name?: string;
}

/** Read a credentials field as a string, whatever the form encoding produced. */
function field(
  credentials: Partial<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = credentials?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * Build the Credentials provider.
 *
 * The returned provider is handed to `createApiAuth({ emailPassword })`, which
 * appends it to the OAuth providers rather than replacing them — the two sign-in
 * methods coexist on one account, which is the entire point of letting a Google
 * user add a password.
 */
export function credentialsProvider(config: CredentialsProviderConfig): Provider {
  return Credentials({
    id: config.id ?? CREDENTIALS_PROVIDER_ID,
    name: config.name ?? "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize: async (credentials): Promise<User | null> => {
      const email = field(credentials, "email");
      const password = field(credentials, "password");
      // Auth.js treats an empty submission as a failed sign-in like any other;
      // going through `authenticate` anyway keeps the timing uniform with a
      // populated one.
      const result = await config.authenticate({ email, password });
      if (!result.ok) throw new EmailPasswordSignin(result.reason);
      return {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name ?? null,
      };
    },
  });
}
