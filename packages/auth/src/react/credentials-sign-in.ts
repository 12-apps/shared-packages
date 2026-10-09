import { useCallback } from "react";

import type { PasswordSignInResult } from "./password-signin";

/** Post the fields to the credentials provider; `createWebAuth` binds where. */
type PostCredentials = (
  fields: Record<string, string>,
  callbackUrl?: string,
) => Promise<PasswordSignInResult>;

/**
 * The two credentials sign-ins, which post the same way and refresh the same
 * way; only the fields differ — an e-mail and a password, or a confirmation
 * link opened in the browser that signed up (FUT-3474).
 */
export function useCredentialsSignIn(
  post: PostCredentials,
  refresh: () => Promise<void>,
): {
  signInWithPassword: (input: {
    email: string;
    password: string;
    callbackUrl?: string;
  }) => Promise<PasswordSignInResult>;
  signInWithLink: (input: { token: string; callbackUrl?: string }) => Promise<PasswordSignInResult>;
} {
  const signInVia = useCallback(
    async (fields: Record<string, string>, callbackUrl?: string): Promise<PasswordSignInResult> => {
      const result = await post(fields, callbackUrl);
      // The cookie is already set by that response; this is what makes the
      // tree re-render as authenticated without a reload.
      if (result.ok) await refresh();
      return result;
    },
    [post, refresh],
  );
  const signInWithPassword = useCallback(
    (input: { email: string; password: string; callbackUrl?: string }) =>
      signInVia({ email: input.email, password: input.password }, input.callbackUrl),
    [signInVia],
  );
  const signInWithLink = useCallback(
    (input: { token: string; callbackUrl?: string }) =>
      signInVia({ linkToken: input.token }, input.callbackUrl),
    [signInVia],
  );
  return { signInWithPassword, signInWithLink };
}
