/**
 * `@12-apps/pwa/server` — the request-time half of installability, with no React
 * and no `window` in the module graph (a Node ESM loader evaluates a whole
 * barrel, so a server importing the React entry would die on MUI before its
 * first route was mounted).
 */
export {
  createApiPwa,
  type ApiPwa,
  type PwaRequest,
  type PwaRoute,
  type PwaRouteResponse,
  type PwaServerConfig,
} from "./create-api-pwa";
export {
  buildWebAppManifest,
  shortNameFor,
  type PwaApp,
  type PwaManifestDefaults,
  type PwaManifestIcon,
  type WebAppManifest,
} from "./manifest";
export {
  pwaServiceWorkerSource,
  type PwaServiceWorkerOptions,
} from "./service-worker-source";
