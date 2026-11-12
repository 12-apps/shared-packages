import type { CancellationReason, MarketplaceAdapter } from "./adapter";
import { PROVIDER_ID_PATTERN, type MarketplaceProvider } from "./types";

/**
 * The adapter registry: the ONE place a provider id becomes a marketplace.
 *
 * Every dispatch in the engine — normalize, signature, outbound, reasons, the
 * app link — asks this registry, so no module below it holds a branch on a
 * provider id. Registering an adapter is the whole cost of a marketplace.
 */
export interface AdapterRegistry {
  /** The adapter for this provider, or null when none is registered. */
  get(provider: string): MarketplaceAdapter | null;
  /** Whether a provider id names a registered adapter (URL segments arrive as text). */
  has(provider: string): provider is MarketplaceProvider;
  /** Every registered provider, in registration order. */
  providers(): readonly MarketplaceProvider[];
}

/** Thrown at mount when the adapter list cannot be a registry. */
export class MarketplaceAdapterRegistrationError extends Error {
  constructor(message: string) {
    super(`@12-apps/marketplace: ${message}`);
    this.name = "MarketplaceAdapterRegistrationError";
  }
}

function assertReasons(adapter: MarketplaceAdapter): void {
  const codes = new Set<string>();
  for (const reason of adapter.cancellationReasons()) {
    if (reason.code.trim() === "") {
      throw new MarketplaceAdapterRegistrationError(`${adapter.provider} declares a reason with a blank code.`);
    }
    if (codes.has(reason.code)) {
      throw new MarketplaceAdapterRegistrationError(
        `${adapter.provider} declares the reason code "${reason.code}" twice.`,
      );
    }
    codes.add(reason.code);
  }
  if (adapter.capabilities.apiCancel && codes.size === 0) {
    throw new MarketplaceAdapterRegistrationError(
      `${adapter.provider} can cancel through its API but declares no reason to cancel with.`,
    );
  }
}

/**
 * Build the registry, refusing what would only fail later: an empty list, a
 * malformed id, a duplicate provider, a reason list that cannot be validated
 * against.
 */
export function createAdapterRegistry(adapters: readonly MarketplaceAdapter[]): AdapterRegistry {
  if (adapters.length === 0) {
    throw new MarketplaceAdapterRegistrationError("an engine needs at least one adapter.");
  }
  const byProvider = new Map<string, MarketplaceAdapter>();
  for (const adapter of adapters) {
    if (!PROVIDER_ID_PATTERN.test(adapter.provider)) {
      throw new MarketplaceAdapterRegistrationError(
        `provider id "${adapter.provider}" must be uppercase letters, digits and underscores.`,
      );
    }
    if (byProvider.has(adapter.provider)) {
      throw new MarketplaceAdapterRegistrationError(`two adapters claim "${adapter.provider}".`);
    }
    assertReasons(adapter);
    byProvider.set(adapter.provider, adapter);
  }
  const providers = [...byProvider.keys()];
  return {
    get: (provider) => byProvider.get(provider) ?? null,
    has: (provider): provider is MarketplaceProvider => byProvider.has(provider),
    providers: () => providers,
  };
}

/**
 * The reason a refusal carries: the one named by `code`, or — when the store
 * named none — the adapter's first. `null` when the code is not one of the
 * adapter's, which a caller answers as a refusal of the whole request.
 */
export function resolveReason(
  adapter: MarketplaceAdapter,
  code: string | null | undefined,
): CancellationReason | null {
  const reasons = adapter.cancellationReasons();
  if (code === null || code === undefined) return reasons[0] ?? null;
  return reasons.find((reason) => reason.code === code) ?? null;
}

/**
 * The reason a host should preselect: the adapter's "item unavailable" reason
 * when the order cannot be covered, else its first. The SHORTAGE is the
 * host's to judge (stock is the host's), so it arrives as a boolean.
 */
export function suggestReason(
  adapter: MarketplaceAdapter,
  input: { itemUnavailable: boolean },
): CancellationReason | null {
  const reasons = adapter.cancellationReasons();
  if (input.itemUnavailable) {
    const unavailable = reasons.find((reason) => reason.itemUnavailable);
    if (unavailable) return unavailable;
  }
  return reasons[0] ?? null;
}
