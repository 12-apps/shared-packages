import type {
  CredentialStore,
  CustomerInfo,
  CycleStore,
  InstrumentLookup,
  MerchantRef,
  PaymentsGateway,
} from "@12-apps/payments-backend";

/**
 * The host-side seams the server half charges and vaults through.
 *
 * Every one of them is a place where the answer is a fact about ONE
 * deployment's database or its provider account, and none of them is
 * something this package could derive. They are declared here, in one file,
 * so an adopting host can read the whole obligation in one screen instead of
 * discovering it a factory at a time.
 *
 * The gateway and credential seams are `Pick`ed rather than taken whole: a
 * host builds its payments gateway once and passes it in, and narrowing here
 * is what documents that this package raises charges and manages vault
 * entries and does nothing else with it — it cannot rotate a credential or
 * rewrite a failover chain.
 */

/** What this package needs from the host's already-built payments gateway. */
export interface BillingPayments {
  gateway: Pick<PaymentsGateway, "charge" | "beginVault" | "completeVault" | "forgetVault">;
  credentials: Pick<CredentialStore, "defaultProvider">;
}

/** The facts every server-side factory shares — see each field. */
export interface BillingPlatformDeps {
  /**
   * The host's payments gateway, resolved per call.
   *
   * A promise-returning accessor rather than the built object, because a host
   * builds its gateway lazily over a database client it also builds lazily —
   * and a package that demanded it at construction would force the whole
   * payment stack to exist before the first request that needs it.
   */
  payments(): Promise<BillingPayments>;
  /**
   * The merchant subscription money is collected INTO — the platform's own
   * account, never the customer's connected one.
   *
   * The inversion this whole surface rests on: everywhere else in a
   * marketplace the customer is the merchant and their buyer is the payer;
   * here the platform is the merchant and the customer is the payer. Charging
   * a customer's own account to pay their subscription would take money from
   * them and hand it straight back, so the ref is an argument the host states
   * once rather than something resolved per call.
   */
  merchant: MerchantRef;
  /**
   * Whether this deployment can collect at all — checked FIRST and EARLY.
   *
   * A deployment with no platform account should do nothing quietly, not raise
   * a charge that throws deep inside the gateway once per customer.
   */
  enabled(): Promise<boolean>;
}

/** Who a vault session is being opened for — resolved from the host's own row. */
export interface VaultTarget {
  /** The subscription. Stamped into provider metadata; see `createCardVault`. */
  subscriptionId: string;
  /**
   * A provider customer this subscription already holds at the active
   * provider, or null. Reusing it keeps an account to one customer object, so
   * "replace my card" replaces rather than accumulating a second customer
   * whose card nothing points at.
   */
  customerRef: string | null;
  /** The account as the provider must see them. */
  customer: CustomerInfo;
}

/** The host's subscription rows, as the vault flow reads them. */
export interface SubscriptionVaultDirectory {
  /**
   * Resolve the vault target for one owner at one provider, or null when the
   * owner has no subscription to attach a card to.
   *
   * The `ownerId` is whatever the host scopes subscriptions by. It must come
   * from the host's own guarded lookup — never from the request — because the
   * subscription id this returns is the anti-substitution check the provider
   * session is bound to.
   */
  findTarget(ownerId: string, provider: string): Promise<VaultTarget | null>;
}

/** A stored pointer, as the removal path needs it: enough to detach it. */
export interface StoredVaultPointer {
  /** The host's row id — handed back to `forget` unchanged. */
  id: string;
  provider: string;
  providerCustomerId: string | null;
  providerInstrumentId: string;
}

/** What the vaulting flow hands the host for storage. */
export interface SaveVaultedInstrument {
  ownerId: string;
  subscriptionId: string;
  provider: string;
  providerCustomerId?: string;
  providerInstrumentId: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

/** What a screen may see of a stored card, and nothing more. */
export interface InstrumentCard {
  provider: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  /** Whether this is the one a cycle is charged against. */
  isDefault: boolean;
}

/**
 * The host's instrument rows.
 *
 * Note what is NOT here: anything card-shaped. The number goes from the
 * cardholder's keyboard to the provider's SDK to the provider; what crosses
 * this seam is an opaque vault id and the display metadata the provider chose
 * to share. No method below has a parameter a card could travel in.
 */
export interface VaultPointerStore {
  /** Persist a freshly vaulted instrument and make it the one we charge. */
  save(instrument: SaveVaultedInstrument): Promise<void>;
  /**
   * EVERY pointer the owner holds, not the one on a screen.
   *
   * An owner can hold a card at yesterday's acquirer as well as today's, and
   * the screen shows one of them; a removal that only saw that one would leave
   * a card on file the owner believes is gone, chargeable again the day
   * someone switches acquirer back.
   */
  listPointers(ownerId: string): Promise<readonly StoredVaultPointer[]>;
  /** Drop one pointer row, by the id `listPointers` handed out. */
  forget(pointerId: string): Promise<void>;
  /** Display metadata for the owner's cards — the read a screen makes. */
  listCards(ownerId: string): Promise<readonly InstrumentCard[]>;
}

/** The host's cycle rows, built per call over its own database client. */
export type CycleStoreFactory = () => Promise<CycleStore>;

export type { CycleStore, InstrumentLookup };
