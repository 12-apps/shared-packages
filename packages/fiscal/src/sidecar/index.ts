/**
 * `@12-apps/fiscal/sidecar` — the wire contract of the fiscal service that
 * ships in this package's `sidecar/` folder (PHP over sped-nfe, with its own
 * Dockerfile): the request and answer bodies of each endpoint and the error
 * classes a failed call is sorted into.
 */

export { SIDECAR_ERROR_CLASSES } from "./types";
export { SIDECAR_PHP_EXTENSIONS, SIDECAR_PHP_LAUNCH_FLAGS, SIDECAR_PHP_SETTINGS, SIDECAR_PHP_VERSION } from "./platform";
export type { SidecarPhpExtension } from "./platform";
export type * from "./types";
