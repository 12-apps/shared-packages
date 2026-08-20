import { createEmailAuth, type EmailAuth, type EmailAuthConfig } from "./create-email-auth";
import { createAuthPages, type AuthLink, type AuthPages, type AuthPagesCopy, type AuthRoutes } from "./pages";
import {
  createEmailAuthScreens,
  type EmailAuthScreens,
} from "./screens";
import type { EmailAuthCopy } from "./screens";
import type { ScreensSession } from "./screens/context";

/**
 * `createWebEmailAuth` — the whole browser surface from one call.
 *
 * The three factories below already existed and every host composed them the
 * same way: build the transport, hand it to the screens, hand THOSE to the
 * pages, then re-export the nine components. In the origin host that composition
 * was a 44-line barrel in a shared SPA package, doing nothing a second host
 * would do differently.
 *
 * It is also the shape `@12-apps/wiring` wants for a `surface` capability —
 * `create(config) → surface`, built once — which is why it exists now rather
 * than as a documented three-step recipe. A recipe is a thing hosts get subtly
 * wrong: forget to pass `useSession` and the two sign-in forms render but
 * cannot sign anybody in, with nothing red until somebody tries.
 *
 * ```ts
 * export const auth = createWebEmailAuth({
 *   basePath: "/api/auth/email",
 *   copy: PT_BR,
 *   pages: PT_BR_PAGES,
 *   useSession,
 *   Link,
 * });
 * ```
 */
export interface WebEmailAuthConfig {
  /** Where the API is mounted. Passed straight to `createEmailAuth`. */
  basePath?: EmailAuthConfig["basePath"];
  /** Anything else the transport takes — a `fetch` under test, most of all. */
  client?: Omit<EmailAuthConfig, "basePath">;
  /** The screens' words. Required, never defaulted — see `EmailAuthCopy`. */
  copy: EmailAuthCopy;
  /** The two pages' words. Required for the same reason. */
  pages: AuthPagesCopy;
  /**
   * The host's session hook. A HOOK, because sign-in is bound to state that
   * only exists during render.
   */
  useSession: () => ScreensSession;
  /** The host router's link component — the one thing a package cannot own. */
  Link: AuthLink;
  /** Where the pages point at each other. `/login` and `/signup` by default. */
  routes?: Partial<AuthRoutes>;
  /** How wide the card may get. See `AuthPagesConfig.maxWidth`. */
  maxWidth?: number;
}

export interface WebEmailAuth extends EmailAuthScreens, AuthPages {
  /** The transport, for a host that needs to call the API directly. */
  client: EmailAuth;
}

/** The default cross-links, which every host so far has used verbatim. */
const DEFAULT_ROUTES: AuthRoutes = { login: "/login", signup: "/signup" };

export function createWebEmailAuth(config: WebEmailAuthConfig): WebEmailAuth {
  const client = createEmailAuth({ ...config.client, basePath: config.basePath });
  const screens = createEmailAuthScreens({
    client,
    copy: config.copy,
    useSession: config.useSession,
  });
  const pages = createAuthPages({
    screens,
    copy: config.pages,
    routes: { ...DEFAULT_ROUTES, ...config.routes },
    Link: config.Link,
    maxWidth: config.maxWidth,
  });
  return { ...screens, ...pages, client };
}
