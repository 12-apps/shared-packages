/**
 * `@12-apps/fiscal/sidecar` — the wire contract of the fiscal service that
 * ships in this package's `sidecar/` folder (PHP over sped-nfe, with its own
 * Dockerfile): the request and answer bodies of each endpoint and the error
 * classes a failed call is sorted into.
 */

export { SIDECAR_ERROR_CLASSES } from "./types";
export type * from "./types";
