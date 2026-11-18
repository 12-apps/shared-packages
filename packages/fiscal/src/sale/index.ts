/**
 * `@12-apps/fiscal/sale` — the neutral document shape (`SaleForDocument`): one
 * sale as the fiscal service accepts it and as the issuer port maps a host's
 * sale into it. Types only; its JSON schema ships beside the service, at
 * `@12-apps/fiscal/sidecar/schema/sale-for-document.schema.json`.
 */

export { PAYMENT_LINK_MEANS } from "./types";
export type * from "./types";
