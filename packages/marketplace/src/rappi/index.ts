import type { CancellationReason, MarketplaceAdapter } from "../core/adapter";
import { RAPPI_ITEM_REASON_CODES, RAPPI_REASON_CODES, type RappiAdapterCopy, type RappiReasonCode } from "./copy";
import {
  RAPPI_PROVIDER,
  RAPPI_SIGNATURE_HEADER,
  normalizeRappiEvent,
  verifyRappiSignature,
  type RappiAmountUnit,
} from "./normalize";
import { rappiReject, rappiTake, type RappiBaseUrls } from "./outbound";

/**
 * `@12-apps/marketplace/rappi` — Rappi, as one adapter on the engine.
 *
 * Built from Rappi's public developer portal (dev-portal.rappi.com), owner's
 * decision 2026-11-11: the NEW_ORDER webhook, take, reject and the M2M client
 * credentials. Everything Rappi is under this folder; the engine reaches it
 * only through the {@link MarketplaceAdapter} port, and registering it is the
 * whole cost:
 *
 * ```ts
 * import { createRappiAdapter } from "@12-apps/marketplace/rappi";
 * import { RAPPI_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/rappi/pt-BR";
 *
 * createMarketplaceEngine({
 *   …ports,
 *   adapters: [
 *     createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR }),
 *     createRappiAdapter({ copy: RAPPI_ADAPTER_COPY_PT_BR, apiBaseUrl, tokenUrl, portalUrl, amountUnit }),
 *   ],
 * });
 * ```
 *
 * Its webhooks (NEW_ORDER and ORDER_EVENT_CANCEL, each registered with Rappi
 * at its own URL) are the engine's one route, `POST
 * /webhooks/marketplace/:tenantSlug/RAPPI`.
 *
 * What Rappi CANNOT do through its public API is stated, never inferred: a
 * reject is only accepted while the order is SENT (before it is taken), and
 * there is no public endpoint to cancel a taken order. So
 * `cancelAfterAccept` is false — the store's cancel of a taken Rappi order is
 * FAILED at once and opens Rappi's portal (the app link) — and the reject's
 * answer is the outcome (`asyncCancellationOutcome: false`).
 */

export { RAPPI_PROVIDER, RAPPI_SIGNATURE_HEADER } from "./normalize";

/**
 * How long a reject may wait to be delivered. From the portal: an order in
 * SENT has "a time limit of 6 minutes to take or reject the order, otherwise
 * it will transition to TIMEOUT status", so a reject that has not reached Rappi
 * six minutes after it was asked can no longer be one. The request is failed
 * as TIMEOUT and a person finishes it on Rappi.
 */
export const RAPPI_CANCELLATION_ANSWER_WINDOW_MS = 6 * 60_000;

/** The one reason that means "an item is unavailable". */
const ITEM_UNAVAILABLE: RappiReasonCode = "ITEM_OUT_OF_STOCK";

const AMOUNT_UNITS: readonly RappiAmountUnit[] = ["MINOR_UNITS", "MAJOR_UNITS"];

export interface RappiAdapterConfig {
  /** The words the adapter needs: reason labels and the missing-number text. Required. */
  copy: RappiAdapterCopy;
  /**
   * The orders API's base per environment, https: the portal's
   * `https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api` (its
   * samples use the `https://microservices.dev.rappi.com` domain). The adapter
   * appends `/orders/{orderId}/take/…` and `/orders/{orderId}/reject`.
   * Required and defaultless: Rappi's account manager confirms the partner's
   * country domain.
   */
  apiBaseUrl: RappiBaseUrls;
  /**
   * The token endpoint per environment, https, whole: the portal's
   * `https://{NEW_DOMAIN}/restaurants/auth/v1/token/login/integrations`
   * ("for integrations services"). Required and defaultless.
   */
  tokenUrl: RappiBaseUrls;
  /** Where "open it on Rappi" goes: the partner portal (Rappi names no per-order link). Required; https only. */
  portalUrl: string;
  /** How Rappi states money for this host's country (see {@link RappiAmountUnit}). Required: ESTIMATED for Brazil. */
  amountUnit: RappiAmountUnit;
}

function assertHttps(name: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`@12-apps/marketplace/rappi: ${name} is not a URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`@12-apps/marketplace/rappi: ${name} must be https.`);
}

function assertConfig(config: RappiAdapterConfig): void {
  for (const env of ["SANDBOX", "PRODUCTION"] as const) {
    assertHttps(`apiBaseUrl.${env}`, config.apiBaseUrl[env]);
    assertHttps(`tokenUrl.${env}`, config.tokenUrl[env]);
  }
  assertHttps("portalUrl", config.portalUrl);
  if (!AMOUNT_UNITS.includes(config.amountUnit)) {
    throw new Error(`@12-apps/marketplace/rappi: amountUnit must be one of ${AMOUNT_UNITS.join(", ")}.`);
  }
}

/** Build the Rappi adapter. Its reasons are static: a dialog never waits on Rappi. */
export function createRappiAdapter(config: RappiAdapterConfig): MarketplaceAdapter {
  assertConfig(config);
  const hosts = { api: { ...config.apiBaseUrl }, token: { ...config.tokenUrl } };
  const reasons: readonly CancellationReason[] = RAPPI_REASON_CODES.map((code) => ({
    code,
    label: config.copy.reasonLabels[code],
    itemUnavailable: code === ITEM_UNAVAILABLE,
    needsItems: RAPPI_ITEM_REASON_CODES.includes(code),
  }));
  const normalizeOptions = { amountUnit: config.amountUnit, missingStreetNumber: config.copy.missingStreetNumber };
  return {
    provider: RAPPI_PROVIDER,
    capabilities: {
      apiConfirm: true,
      apiCancel: true,
      // Reject only from SENT; no public endpoint cancels a TAKEN order.
      cancelAfterAccept: false,
      // 200 is "Order successfully rejected": the answer is the outcome.
      asyncCancellationOutcome: false,
      perOrderAppLink: false,
      // `take/{cookingTime}`, in minutes.
      confirmTakesPreparationTime: true,
      cancellationAnswerWindowMs: RAPPI_CANCELLATION_ANSWER_WINDOW_MS,
    },
    normalize: (payload) => normalizeRappiEvent(payload, normalizeOptions),
    readSignature: (header) => header(RAPPI_SIGNATURE_HEADER),
    verifySignature: verifyRappiSignature,
    cancellationReasons: () => reasons,
    confirm: (ctx, order, input) => rappiTake(ctx, hosts, order, input),
    requestCancellation: (ctx, order, input) => rappiReject(ctx, hosts, order, input),
    appLink: () => config.portalUrl,
  };
}

export { RAPPI_ITEM_REASON_CODES, RAPPI_REASON_CODES, type RappiAdapterCopy, type RappiReasonCode } from "./copy";
export {
  normalizeRappiEvent,
  normalizeRappiOrder,
  verifyRappiSignature,
  type RappiAmountUnit,
  type RappiNormalizeOptions,
} from "./normalize";
export type { RappiBaseUrls, RappiHosts } from "./outbound";
