/**
 * The web-app manifest, as a PER-HOST ENDPOINT (12-23).
 *
 * WHY AN ENDPOINT AND NOT A FILE, in one sentence: **a PWA's identity IS its
 * origin**, and a static bundle has exactly ONE `index.html` for every tenant it
 * serves, so a static `manifest.webmanifest` cannot vary by the store the
 * visitor is actually looking at. One installable app per tenant therefore means
 * one manifest per host, which only a request-time answer can produce.
 *
 * The whole gate is structural for the same reason: whoever the host says is not
 * an app gets a **404**, so "installable" exists exactly where the host's own
 * domain rules say it does — no extra feature flag to keep in sync with the ones
 * that already decide whether a domain serves at all. (the origin host's
 * `docs/PWA.md` has the long version, including the iOS 26 caveat: Safari
 * dropped every installability requirement, so on iOS the 404 no longer *stops*
 * anyone adding an origin to their Home Screen — it decides whether they get the
 * store's name and icon or the browser's fallback.)
 */

/** One icon entry of the W3C manifest. */
export interface PwaManifestIcon {
  src: string;
  sizes: string;
  type: string;
  /**
   * `"any maskable"` is a CLAIM about the asset: a maskable icon must survive
   * being cropped to a circle on Android and a rounded square on iOS. Declaring
   * a transparent, edge-to-edge logo maskable is what produces the white plate
   * this feature exists to avoid — so a host only passes it for an asset its
   * upload flow made opaque and square.
   */
  purpose?: string;
}

/**
 * What the HOST resolves per request: the identity of the app this origin is.
 * `null` from `resolveApp` means "not an app here" → 404.
 */
export interface PwaApp {
  /**
   * Stable app id, e.g. `/minha-loja/`. A changed `id` is a DIFFERENT app to the
   * browser, so anyone who installed the old one ends up with two icons —
   * derive it from a permanent identity (a slug), never from a display name.
   */
  id: string;
  name: string;
  /** Home screens truncate; omit and the package derives one from `name`. */
  shortName?: string;
  /** Where the app opens. Recorded by the browser AT INSTALL TIME. */
  startUrl: string;
  /** What "this app" covers. `"/"` is right only when the whole origin is one app. */
  scope?: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  themeColor?: string;
  /**
   * The splash colour, deliberately NOT the theme colour: it sits behind the
   * icon while the app boots, and a saturated brand colour there reads as a
   * flash rather than as a background.
   */
  backgroundColor?: string;
  /**
   * An EMPTY array is a legitimate manifest — the app is simply not installable
   * yet, which is honest and better than pointing at the platform's own icon on
   * a white-labelled home screen.
   */
  icons?: PwaManifestIcon[];
  /** Anything else the W3C manifest allows (`lang`, `categories`, `orientation`…). */
  extra?: Record<string, unknown>;
}

/** The document the browser's install machinery reads. */
export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: PwaManifestIcon[];
  [key: string]: unknown;
}

/** Defaults a host may override once, rather than per request. */
export interface PwaManifestDefaults {
  themeColor?: string;
  backgroundColor?: string;
  scope?: string;
  display?: PwaApp["display"];
  /** Home screens truncate; the package elides past this length. */
  shortNameMax?: number;
}

const DEFAULT_THEME_COLOR = "#6366F1";
const DEFAULT_BACKGROUND_COLOR = "#FFFFFF";
const DEFAULT_SHORT_NAME_MAX = 12;

/** A short form that fits under a home-screen icon. */
export function shortNameFor(name: string, max = DEFAULT_SHORT_NAME_MAX): string {
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The three-level fallback every optional field walks: what THIS app set, then
 * what the host set once, then the package's own default.
 *
 * Extracted so `buildWebAppManifest` reads as the document it produces. Inline,
 * the same `?? ?? ` chain six times over was the whole function's complexity.
 */
function pick<T>(...candidates: (T | undefined)[]): T | undefined {
  return candidates.find((candidate) => candidate !== undefined);
}

/** Presentation: how the app opens and what colours frame it while it does. */
function presentationOf(
  app: PwaApp,
  defaults: PwaManifestDefaults,
): Pick<WebAppManifest, "scope" | "display" | "theme_color" | "background_color"> {
  return {
    scope: pick(app.scope, defaults.scope) ?? "/",
    display: pick(app.display, defaults.display) ?? "standalone",
    theme_color: pick(app.themeColor, defaults.themeColor) ?? DEFAULT_THEME_COLOR,
    // Deliberately NOT the theme colour: this sits behind the icon while the app
    // boots, and a saturated brand colour there reads as a flash.
    background_color:
      pick(app.backgroundColor, defaults.backgroundColor) ?? DEFAULT_BACKGROUND_COLOR,
  };
}

/** Build the W3C manifest for one resolved app. */
export function buildWebAppManifest(
  app: PwaApp,
  defaults: PwaManifestDefaults = {},
): WebAppManifest {
  return {
    id: app.id,
    name: app.name,
    short_name: app.shortName ?? shortNameFor(app.name, defaults.shortNameMax),
    start_url: app.startUrl,
    ...presentationOf(app, defaults),
    icons: app.icons ?? [],
    ...(app.extra ?? {}),
  };
}
