import { createEmailAuth, type EmailAuth, type EmailAuthConfig } from "./create-email-auth";
import {
  createAuthPages,
  createAuthRoutes,
  type AuthLink,
  type AuthPages,
  type AuthPagesConfig,
  type AuthPagesCopy,
  type AuthRouteComponents,
  type AuthRoutes,
  type AuthRoutesConfig,
} from "./pages";
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
  /**
   * An ALREADY-BUILT transport, for a host whose shell owns one.
   *
   * Wins over `basePath`/`client`, which then go unused. It exists because the
   * alternative is two clients that merely happen to agree: `@12-apps/app-shell`
   * builds an `EmailAuth` beside the session with the deployment's own
   * `emailAuthBasePath`, and a host that also let this factory build one would
   * be one setting away from a screen pointed somewhere the session is not.
   * That agreement holds until somebody changes the shell's, and then a
   * forgotten password 404s on a screen nobody exercises until they need it.
   */
  transport?: EmailAuth;
  /** The screens' words. Required, never defaulted — see `EmailAuthCopy`. */
  copy: EmailAuthCopy;
  /** The two pages' words. Required for the same reason. */
  pages: AuthPagesCopy;
  /**
   * The host's session hook. A HOOK, because sign-in is bound to state that
   * only exists during render.
   */
  useSession: () => ScreensSession;
  /**
   * The host router's link component — the one thing a package cannot own.
   *
   * OPTIONAL since the multi-router door below: a host serving several routers
   * off one set of screens has none to name here, and builds its pages per
   * router with {@link WebEmailAuth.createPages}. Omitting it renders both
   * pages without their cross-link footer, which is the same meaning omitting
   * `routes.signup` already carries.
   */
  Link?: AuthLink;
  /** Where the pages point at each other. `/login` and `/signup` by default. */
  routes?: Partial<AuthRoutes>;
  /** How wide the card may get. See `AuthPagesConfig.maxWidth`. */
  maxWidth?: number;
}

export interface WebEmailAuth extends EmailAuthScreens, AuthPages {
  /** The transport, for a host that needs to call the API directly. */
  client: EmailAuth;
  /**
   * The two pages again, bound to ANOTHER router.
   *
   * The eager `LoginPage`/`SignupPage` above are the one-router case, which is
   * every host until it is not. A repo whose SPAs share one sign-in module —
   * one storefront, one backoffice, one operator console, three routers and one
   * of them under a basename — cannot name a single `Link` at factory time, and
   * before this door its only route was to re-run the three-factory composition
   * by hand. That is precisely the recipe this factory exists to stop hosts
   * getting subtly wrong.
   *
   * Same `screens`, so every router shares one transport and one session. The
   * caller supplies what genuinely differs: its `Link`, its paths, and any
   * per-app wording.
   */
  createPages(config: Omit<AuthPagesConfig, "screens">): AuthPages;
  /**
   * The whole `/login` + `/signup` ROUTE pair, bound to another router.
   *
   * `createAuthRoutes` is the layer above the pages — the `?callbackUrl` read,
   * the redirect for a visitor who is already signed in, the settings probe,
   * and the Auth.js code-to-sentence map — and it was reachable only by
   * importing it separately, which meant a host adopting this surface through
   * the wiring contract got the pages and had to compose the routes itself.
   */
  createRoutes(config: Omit<AuthRoutesConfig, "screens">): AuthRouteComponents;
}

/** The default cross-links, which every host so far has used verbatim. */
const DEFAULT_ROUTES: AuthRoutes = { login: "/login", signup: "/signup" };

export function createWebEmailAuth(config: WebEmailAuthConfig): WebEmailAuth {
  const client =
    config.transport ?? createEmailAuth({ ...config.client, basePath: config.basePath });
  const screens = createEmailAuthScreens({
    client,
    copy: config.copy,
    useSession: config.useSession,
  });
  const pages = createAuthPages({
    screens,
    copy: config.pages,
    routes: { ...DEFAULT_ROUTES, ...config.routes },
    ...(config.Link === undefined ? {} : { Link: config.Link }),
    maxWidth: config.maxWidth,
  });
  return {
    ...screens,
    ...pages,
    client,
    // `screens` is closed over, not rebuilt: every router this surface serves
    // reads one transport and one session, which is the whole reason the door
    // is here rather than in a second factory call.
    createPages: (forRouter) => createAuthPages({ ...forRouter, screens }),
    createRoutes: (forRouter) => createAuthRoutes({ ...forRouter, screens }),
  };
}
