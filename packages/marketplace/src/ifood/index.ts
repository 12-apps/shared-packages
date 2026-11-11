import type { CancellationReason, MarketplaceAdapter } from "../core/adapter";
import { IFOOD_REASON_CODES, type IfoodAdapterCopy, type IfoodReasonCode } from "./copy";
import { normalizeIfoodEvent, verifyIfoodSignature } from "./normalize";
import { IFOOD_PORTAL_URL, ifoodConfirm, ifoodRequestCancellation } from "./outbound";

/**
 * `@12-apps/marketplace/ifood` — iFood, as one adapter on the engine.
 *
 * The owner's rule: adapters live inside the lib, one per subpath, and no
 * provider-specific branch exists anywhere outside an adapter and its
 * registration. Everything iFood is under this folder; the engine reaches it
 * only through the {@link MarketplaceAdapter} port.
 *
 * ```ts
 * import { createIfoodAdapter } from "@12-apps/marketplace/ifood";
 * import { IFOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/ifood/pt-BR";
 *
 * createMarketplaceEngine({ …ports, adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR })] });
 * ```
 */

/** The provider id iFood is registered under. */
export const IFOOD_PROVIDER = "IFOOD";

/** The one reason that means "an item is unavailable". */
const ITEM_UNAVAILABLE: IfoodReasonCode = "503";

export interface IfoodAdapterConfig {
  /** The words the adapter needs: reason labels and the missing-number text. Required. */
  copy: IfoodAdapterCopy;
}

/** Build the iFood adapter. Its reasons are static: a dialog never waits on iFood. */
export function createIfoodAdapter(config: IfoodAdapterConfig): MarketplaceAdapter {
  const reasons: readonly CancellationReason[] = IFOOD_REASON_CODES.map((code) => ({
    code,
    label: config.copy.reasonLabels[code],
    itemUnavailable: code === ITEM_UNAVAILABLE,
    needsItems: false,
  }));
  const normalizeOptions = { missingStreetNumber: config.copy.missingStreetNumber };
  return {
    provider: IFOOD_PROVIDER,
    capabilities: {
      apiConfirm: true,
      apiCancel: true,
      cancelAfterAccept: true,
      asyncCancellationOutcome: true,
      perOrderAppLink: false,
      confirmTakesPreparationTime: false,
    },
    normalize: (payload) => normalizeIfoodEvent(payload, normalizeOptions),
    readSignature: (header) => header("x-ifood-signature") ?? header("x-signature"),
    verifySignature: verifyIfoodSignature,
    cancellationReasons: () => reasons,
    confirm: (ctx, order) => ifoodConfirm(ctx, order),
    requestCancellation: ifoodRequestCancellation,
    // No per-order deep link is known, so the portal, where a live order is
    // on the first screen.
    appLink: () => IFOOD_PORTAL_URL,
  };
}

export { IFOOD_REASON_CODES, type IfoodAdapterCopy, type IfoodReasonCode } from "./copy";
export { normalizeIfoodEvent, verifyIfoodSignature } from "./normalize";
