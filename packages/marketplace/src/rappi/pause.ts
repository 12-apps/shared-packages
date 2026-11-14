import {
  answered,
  outboundResultOf,
  type AdapterCallContext,
  type OutboundResult,
} from "../core/adapter";
import type { MarketplaceAvailability, StorePauseRequest, StorePauseResult } from "../core/pause-port";
import { RAPPI_PROVIDER } from "./normalize";
import { bearer, trimmed, type RappiHosts } from "./outbound";

/**
 * Rappi's half of the store pause (FUT-4851): a store-wide SWITCH, from
 * Rappi's public developer portal (dev-portal.rappi.com, api-reference
 * "availability", read 2026-11-13):
 *
 * `PUT https://{COUNTRY_DOMAIN}/api/v2/restaurants-integrations-public-api/availability/stores/enable`,
 * synchronous, with `{ stores: [{ store_id, is_enabled }] }`; 200 with a
 * `results` array (`store_id`, `is_enabled`, `operation_result`,
 * `operation_result_type`, `operation_result_message`, `suspended_reason`, …),
 * 400, 403 "not allowed to update those stores", 422 too many stores, 502.
 *
 * A switch has no id and no end: the engine turns a store on only when its
 * own record says it turned it off, and turns it on by itself once the
 * kitchen's `until` has passed unrenewed. What it cannot tell apart is a store
 * the owner ALSO closed by hand during the kitchen's pause, which is why the
 * adapter offers this only when the host opts in (`pauseByStoreSwitch`).
 *
 * ESTIMATED: which id `store_id` is (the portal says "the one from your
 * system" for this call; the engine sends the connection's merchant id, the
 * store id Rappi's own events carry), and how a per-store failure reads in
 * `results` (an `operation_result` of `false`, or a `operation_result_type`
 * naming an error, is taken as a refusal with `operation_result_message`).
 */

interface RappiStoreResult {
  store_id?: unknown;
  operation_result?: unknown;
  operation_result_type?: unknown;
  operation_result_message?: unknown;
}

/** This store's entry in the answer's `results`, judged; null when the answer names it as done. */
function refusalIn(body: string, storeId: string): Exclude<OutboundResult, { kind: "accepted" }> | null {
  let results: RappiStoreResult[];
  try {
    const parsed = JSON.parse(body === "" ? "{}" : body) as { results?: unknown };
    results = Array.isArray(parsed.results) ? (parsed.results as RappiStoreResult[]) : [];
  } catch {
    return null;
  }
  const entry = results.find((result) => String(result.store_id) === storeId);
  if (!entry) return null;
  const type = typeof entry.operation_result_type === "string" ? entry.operation_result_type : "";
  const failed = entry.operation_result === false || /error|fail/iu.test(type);
  if (!failed) return null;
  const message = typeof entry.operation_result_message === "string" ? entry.operation_result_message : type;
  return { kind: "refused", status: 200, message: message.slice(0, 300) };
}

const tokenKey = (ctx: AdapterCallContext): string => `${RAPPI_PROVIDER}:${ctx.environment}:${ctx.credentials.clientId}`;

/** Turn the store on or off; the answer judged for THIS store. */
export function rappiSetStoreEnabled(
  ctx: AdapterCallContext,
  hosts: RappiHosts,
  storeId: string,
  enabled: boolean,
): Promise<OutboundResult> {
  return answered(async () => {
    const auth = await bearer(ctx, hosts);
    if (!("token" in auth)) return auth;
    const response = await ctx.http({
      method: "PUT",
      url: `${trimmed(hosts.api[ctx.environment])}/availability/stores/enable`,
      headers: { "x-authorization": `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stores: [{ store_id: storeId, is_enabled: enabled }] }),
    });
    if (response.status === 401) {
      ctx.tokens.delete(tokenKey(ctx));
      return { kind: "retry", reason: "Rappi refused the token" };
    }
    const result = outboundResultOf(response);
    if (result.kind !== "accepted") return result;
    return refusalIn(response.body, storeId) ?? result;
  });
}

/** Rappi's availability capability: a switch, offered only when the host opts in. */
export function rappiAvailability(hosts: RappiHosts): MarketplaceAvailability {
  return {
    kind: "switch",
    pause: async (ctx: AdapterCallContext, request: StorePauseRequest): Promise<StorePauseResult> => {
      const result = await rappiSetStoreEnabled(ctx, hosts, request.merchantId, false);
      return result.kind === "accepted" ? { kind: "paused", externalId: null, until: request.until } : result;
    },
    resume: (ctx, ref) => rappiSetStoreEnabled(ctx, hosts, ref.merchantId, true),
  };
}
