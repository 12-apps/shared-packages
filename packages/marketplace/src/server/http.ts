import type { z } from "zod";

import type { WireResponse } from "@12-apps/wiring";

import type { MarketplaceEngine } from "../core/engine";
import type { MarketplaceLogger } from "../core/ports";
import type { MarketplaceServerCopy } from "./copy";

/**
 * What the route descriptors share: the config, the actor, and the two answer
 * shapes every handler uses.
 */

/** Whoever the host resolved: the tenant this request may act inside. */
export interface MarketplaceActor {
  /** The tenant's id — every engine call is scoped to it. */
  clientId: string;
}

export interface MarketplaceApiConfig {
  /** The mounted engine (`createMarketplaceEngine`). */
  engine: MarketplaceEngine;
  /** Every sentence the routes answer a person with. Required, no defaults. */
  copy: MarketplaceServerCopy;
  /**
   * Which tenant a webhook's URL slug names, or null for none. The webhook is
   * unauthenticated by design (a marketplace cannot sign in), so the tenant
   * comes from the URL and is then proved by that tenant's signature secret.
   */
  tenantBySlug: (slug: string) => Promise<string | null>;
  /** Where the routes say what they refused. The manifest's `marketplace` namespace. */
  logger: MarketplaceLogger;
}

/** A 200 in the `{ data }` envelope. */
export function ok(data: unknown): WireResponse {
  return { status: 200, body: { data } };
}

/** A refusal in the `{ error }` envelope, with any extra fields beside it. */
export function refuse(status: number, error: string, extra: Record<string, unknown> = {}): WireResponse {
  return { status, body: { error, ...extra } };
}

/** The parsed value, or the 422 that names every problem and its path. */
export function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  copy: MarketplaceServerCopy,
): { ok: true; value: T } | { ok: false; response: WireResponse } {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));
  return { ok: false, response: refuse(422, copy.invalidInput, { issues }) };
}

/** An ISO string, or null. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
