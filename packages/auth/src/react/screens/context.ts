import { createContext, useContext } from "react";

import type { PasswordSignInResult } from "../password-signin";
import type { EmailAuth } from "../create-email-auth";
import type { EmailAuthCopy } from "./copy";

/**
 * What the host hands these screens, and how they reach it.
 *
 * A React context rather than props threaded through every component: the
 * config is the same for every screen in an app and never changes after mount,
 * so passing it down would be nine components carrying three props they mostly
 * only forward. It is created by {@link createEmailAuthScreens} and read by
 * {@link useScreens}; nothing here is exported to a host.
 */

/**
 * The host's sign-in, as these screens need it.
 *
 * Structurally minimal on purpose. `createWebAuth().useSession` satisfies it,
 * which is the intended pairing — but a host that authenticates some other way
 * can satisfy it too, and nothing here requires this package's own session.
 */
export interface ScreensSession {
  signInWithPassword: (input: {
    email: string;
    password: string;
    callbackUrl?: string;
  }) => Promise<PasswordSignInResult>;
}

export interface EmailAuthScreensConfig {
  /** The browser client, from `createEmailAuth`. Every request goes through it. */
  client: EmailAuth;
  /** Every user-facing string. See {@link EmailAuthCopy} for why there is no default. */
  copy: EmailAuthCopy;
  /**
   * The host's session hook — `createWebAuth().useSession`, normally.
   *
   * A HOOK rather than the function itself, because the host's sign-in is
   * bound to session state that only exists during render. Called by the two
   * forms that sign somebody in; the other screens never touch it.
   */
  useSession: () => ScreensSession;
}

const ScreensContext = createContext<EmailAuthScreensConfig | null>(null);

export const ScreensProvider = ScreensContext.Provider;

/**
 * The config for the screen currently rendering.
 *
 * Throws rather than defaulting: a screen with no config would render a page of
 * `undefined` and fire no requests, which looks like a backend problem. The
 * component name is not in the message because the stack already has it.
 */
export function useScreens(): EmailAuthScreensConfig {
  const config = useContext(ScreensContext);
  if (!config) {
    throw new Error(
      "an e-mail auth screen was rendered outside createEmailAuthScreens() — " +
        "use the components that factory returns, not the ones it wraps",
    );
  }
  return config;
}
