import {
  UnsupportedOperationError,
  forgetVaultPointers,
  type VaultPointerRef,
} from "@12-apps/payments-backend";

import type {
  BillingPlatformDeps,
  SubscriptionVaultDirectory,
  VaultPointerStore,
  VaultTarget,
} from "./ports";

/**
 * Putting a subscriber's card on file — and taking it off again (FUT-340).
 *
 * ## No card ever reaches this process
 *
 * The PAN goes from the cardholder's keyboard to the provider's SDK to the
 * provider. What comes back here is an opaque vault id and the display
 * metadata the provider chose to share — "do not store cards at all; vaulting
 * lives entirely in the vendor's system" — and it is visible in the fact that
 * no function below has a parameter a card could travel in.
 *
 * ## The two calls that create one, and why the second is the dangerous one
 *
 * `begin` opens a provider session for THIS owner's subscription and returns
 * what the browser needs. `complete` is then reached from that browser, so its
 * session id is attacker-supplied and names an object at the PROVIDER rather
 * than in the host's database.
 *
 * What makes that safe is the SUBSCRIPTION ID: `begin` stamps it into the
 * session's provider-side metadata, and `complete` requires the session to
 * carry it back. This layer's whole responsibility is that the id it passes
 * comes from the host's own subscription row and never from the request — so
 * an owner posting somebody else's session id is refused by the adapter. The
 * `findTarget` port carries that obligation; see its doc.
 *
 * Server-only.
 */

/** Why vaulting could not start, when the reason is not an exception. */
export type VaultRejection =
  /** This deployment has no platform merchant account configured. */
  | "no-platform-account"
  /** The owner has no subscription to attach a card to. */
  | "no-subscription"
  /** The active acquirer cannot save a card without charging for it. */
  | "provider-cannot-vault";

/** What the browser needs to mint an instrument, with no secret in it. */
export interface VaultStart {
  provider: string;
  tokenization: string;
  publicKey: string | null;
  /** Single-use and scoped to one session — its whole purpose is to be sent. */
  clientSecret: string | null;
  sessionId: string | null;
}

/** Either half of the vault flow: the value, or the reason there is none. */
export type VaultOutcome<TValue> =
  | ({ ok: true } & TValue)
  | { ok: false; rejection: VaultRejection };

export interface CardVault {
  /** Open a vaulting session for the owner's subscription. */
  begin(ownerId: string): Promise<VaultOutcome<{ start: VaultStart }>>;
  /**
   * Finish vaulting and store the instrument.
   *
   * `sessionId` is the ONLY thing taken from the request. The customer handed
   * to the adapter comes from the owner's own subscription row, so the
   * adapter's ownership check compares the session against a value the caller
   * could not influence — which is what stops one owner completing a
   * stranger's session and attaching their card.
   */
  complete(ownerId: string, sessionId: string): Promise<VaultOutcome<Record<never, never>>>;
  /**
   * Take the owner's cards back OFF file.
   *
   * EVERY pointer they hold, not the one on the screen — see
   * `VaultPointerStore.listPointers`. The provider-first order, the
   * drop-on-permanent-refusal rule and the refuse-on-retriable stop are
   * `forgetVaultPointers`' contract (FUT-760); what is contributed here is
   * which rows count as "on file" and how a pointer row is deleted.
   */
  forgetAll(ownerId: string): Promise<{ ok: boolean }>;
}

export interface CardVaultDeps extends BillingPlatformDeps {
  subscriptions: SubscriptionVaultDirectory;
  instruments: VaultPointerStore;
}

const NO_PLATFORM = { ok: false, rejection: "no-platform-account" } as const;
const NO_SUBSCRIPTION = { ok: false, rejection: "no-subscription" } as const;

/** The vault gateway, plus whose subscription this is. */
type OpenedVault =
  | { ok: true; gateway: Awaited<ReturnType<CardVaultDeps["payments"]>>["gateway"]; target: VaultTarget }
  | { ok: false; rejection: VaultRejection };

/**
 * The three questions every vault call opens with: can this deployment
 * collect, which provider is it collecting through, and whose subscription is
 * this.
 *
 * Shared so `begin` and `complete` cannot answer them differently — a
 * `complete` resolving a different provider than its `begin` would hand the
 * adapter a session it never minted.
 */
async function openVault(deps: CardVaultDeps, ownerId: string): Promise<OpenedVault> {
  if (!(await deps.enabled())) return NO_PLATFORM;

  const { credentials, gateway } = await deps.payments();
  const provider = await credentials.defaultProvider(deps.merchant);
  if (!provider) return NO_PLATFORM;

  const target = await deps.subscriptions.findTarget(ownerId, provider);
  if (!target) return NO_SUBSCRIPTION;

  return { ok: true, gateway, target };
}

async function beginVault(
  deps: CardVaultDeps,
  ownerId: string,
): Promise<VaultOutcome<{ start: VaultStart }>> {
  const opened = await openVault(deps, ownerId);
  if (!opened.ok) return opened;

  try {
    const session = await opened.gateway.beginVault(deps.merchant, {
      reference: opened.target.subscriptionId,
      customer: opened.target.customer,
      customerRef: opened.target.customerRef ?? undefined,
    });
    return {
      ok: true,
      start: {
        provider: session.provider,
        tokenization: session.tokenization,
        publicKey: session.publicKey ?? null,
        clientSecret: session.clientSecret ?? null,
        sessionId: session.sessionId ?? null,
      },
    };
  } catch (error) {
    // A provider with no vault is a state of the world an operator can fix by
    // switching acquirer, not an error the owner caused.
    if (error instanceof UnsupportedOperationError) {
      return { ok: false, rejection: "provider-cannot-vault" };
    }
    throw error;
  }
}

async function completeVault(
  deps: CardVaultDeps,
  ownerId: string,
  sessionId: string,
): Promise<VaultOutcome<Record<never, never>>> {
  const opened = await openVault(deps, ownerId);
  if (!opened.ok) return opened;

  const vaulted = await opened.gateway.completeVault(deps.merchant, {
    sessionId,
    // Resolved from THIS owner's subscription, never echoed from the request.
    reference: opened.target.subscriptionId,
    customerRef: opened.target.customerRef ?? undefined,
  });

  await deps.instruments.save({
    ownerId,
    subscriptionId: opened.target.subscriptionId,
    provider: vaulted.provider,
    providerCustomerId: vaulted.customerRef,
    providerInstrumentId: vaulted.instrumentId,
    brand: vaulted.brand,
    last4: vaulted.last4,
    expMonth: vaulted.expMonth,
    expYear: vaulted.expYear,
  });

  return { ok: true };
}

async function forgetAllCards(deps: CardVaultDeps, ownerId: string): Promise<{ ok: boolean }> {
  const pointers = await deps.instruments.listPointers(ownerId);
  // Idempotent by construction: an owner with nothing on file has already
  // arrived where this call was going, and a 404 for that would be a lie.
  if (pointers.length === 0) return { ok: true };

  const { gateway } = await deps.payments();
  // Keyed by ref identity: the payments package hands each ref back to
  // `dropPointer` unchanged, and the row id is a host fact its
  // `VaultPointerRef` never sees.
  const rowIds = new Map<VaultPointerRef, string>();
  const refs = pointers.map((pointer) => {
    const ref: VaultPointerRef = {
      provider: pointer.provider,
      instrumentId: pointer.providerInstrumentId,
      customerRef: pointer.providerCustomerId,
    };
    rowIds.set(ref, pointer.id);
    return ref;
  });

  return forgetVaultPointers(gateway, deps.merchant, refs, async (ref) => {
    const rowId = rowIds.get(ref);
    if (rowId) await deps.instruments.forget(rowId);
  });
}

/** Bind the ports once; the three calls above are the whole surface. */
export function createCardVault(deps: CardVaultDeps): CardVault {
  return {
    begin: (ownerId) => beginVault(deps, ownerId),
    complete: (ownerId, sessionId) => completeVault(deps, ownerId, sessionId),
    forgetAll: (ownerId) => forgetAllCards(deps, ownerId),
  };
}
