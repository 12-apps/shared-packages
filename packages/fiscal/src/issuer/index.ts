/**
 * `@12-apps/fiscal/issuer` — the Issuer port and its first adapter, the
 * fiscal service in this package's `sidecar/` folder.
 */

export { modelPath } from "./port";
export type * from "./port";
export { createSidecarIssuer } from "./sidecar";
export type { SidecarFetch, SidecarIssuerConfig } from "./sidecar";
