import {
  buildWebAppManifest,
  type PwaApp,
  type PwaManifestDefaults,
  type WebAppManifest,
} from "./manifest";
import {
  pwaServiceWorkerSource,
  type PwaServiceWorkerOptions,
} from "./service-worker-source";

/**
 * The one thing this package exposes to a BACKEND host (12-23): the two
 * request-time assets that make an app installable, as framework-neutral route
 * descriptors (the report-builder doctrine). `@12-apps/pwa/hono` mounts them.
 *
 * What stays the HOST's is the only genuinely host-shaped question — **is this
 * origin an app, and which one?** future-pay answers it by resolving the request
 * hostname to a verified custom domain and checking the tenant's plan; another
 * host might answer from a config map. `resolveApp` returning `null` is a 404,
 * and that 404 IS the gate.
 */

/** What a handler is given: the incoming request, already routed. */
export interface PwaRequest {
  /** The Fetch `Request`, for a host that reads forwarded headers itself. */
  request: Request;
  /** `Host` (or the host the adapter resolved), lowercased, no port stripping. */
  host: string;
}

/** What a handler answers with — a body, a status and headers. */
export interface PwaRouteResponse {
  status: number;
  /** `null` means an EMPTY body (the 404 has nothing to say and nothing to leak). */
  body: string | null;
  headers: Record<string, string>;
}

export interface PwaRoute {
  method: "GET";
  /**
   * Absolute path from the ORIGIN ROOT, because both of these have to be served
   * from the root to do their job: a worker's directory bounds its scope, and the
   * manifest is linked from a static `index.html` that cannot know a prefix.
   */
  path: string;
  handle(request: PwaRequest): Promise<PwaRouteResponse>;
}

export interface PwaServerConfig {
  /**
   * Which app this request's origin is, or `null` for "not an app here" (404).
   * The host's domain rules, plan gates and branding all live in this one
   * function — everything after it is the package's.
   */
  resolveApp: (request: PwaRequest) => Promise<PwaApp | null> | PwaApp | null;
  /** Defaults for fields most apps set once (theme, background, scope, display). */
  defaults?: PwaManifestDefaults;
  /** Where the manifest is served. Default `/manifest.webmanifest`. */
  manifestPath?: string;
  /**
   * Cache-Control for the manifest. Default: five minutes, revalidated — long
   * enough not to re-fetch on every visit, short enough that a rebrand shows up
   * the same day. What actually reaches an ALREADY-INSTALLED device is the icon
   * URL, so version those (`?v=`) rather than shortening this.
   */
  manifestCacheControl?: string;
  /**
   * Serve the packaged worker too. `false` (the default) leaves it to a static
   * file the host writes at build time from `pwaServiceWorkerSource()`.
   */
  serviceWorker?:
    | false
    | (PwaServiceWorkerOptions & {
        /** Where it is served. Default `/sw.js` — the ROOT, so its scope is `/`. */
        path?: string;
      });
}

const DEFAULT_MANIFEST_PATH = "/manifest.webmanifest";
const DEFAULT_WORKER_PATH = "/sw.js";
const DEFAULT_MANIFEST_CACHE = "public, max-age=300, must-revalidate";

/** No manifest here. Empty body — nothing to say, and nothing to leak. */
function notAnApp(): PwaRouteResponse {
  return { status: 404, body: null, headers: { "cache-control": "no-store" } };
}

export interface ApiPwa {
  routes: PwaRoute[];
  /** The exact worker text this mount serves — for a build-time write, or a test. */
  serviceWorkerSource: string | null;
  /** The manifest for one resolved app, for a host that renders it elsewhere. */
  buildManifest: (app: PwaApp) => WebAppManifest;
}

export function createApiPwa(config: PwaServerConfig): ApiPwa {
  const manifestPath = config.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const worker = config.serviceWorker === false ? undefined : config.serviceWorker;
  const workerSource = worker ? pwaServiceWorkerSource(worker) : null;
  const buildManifest = (app: PwaApp): WebAppManifest =>
    buildWebAppManifest(app, config.defaults ?? {});

  const routes: PwaRoute[] = [
    {
      method: "GET",
      path: manifestPath,
      async handle(request) {
        const app = await config.resolveApp(request);
        if (!app) return notAnApp();
        return {
          status: 200,
          body: JSON.stringify(buildManifest(app)),
          headers: {
            // NOT the house `{ data }` envelope: this body is read by the
            // BROWSER's install machinery, which expects the W3C manifest shape
            // at the top level — wrapping it would simply make it unreadable.
            "content-type": "application/manifest+json; charset=utf-8",
            "cache-control": config.manifestCacheControl ?? DEFAULT_MANIFEST_CACHE,
          },
        };
      },
    },
  ];

  if (worker && workerSource) {
    routes.push({
      method: "GET",
      path: worker.path ?? DEFAULT_WORKER_PATH,
      async handle() {
        return {
          status: 200,
          body: workerSource,
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            // The worker's own scope is its directory; this header is what lets
            // one served from anywhere claim the root. Harmless at the root.
            "service-worker-allowed": "/",
            // Never cached hard: the worker is how a bad worker gets replaced.
            "cache-control": "no-cache",
          },
        };
      },
    });
  }

  return { routes, serviceWorkerSource: workerSource, buildManifest };
}
