import { vi } from "vitest";

import type { MerchantRef } from "@12-apps/payments-backend";

import type {
  BillingPayments,
  InstrumentCard,
  SaveVaultedInstrument,
  StoredVaultPointer,
  SubscriptionVaultDirectory,
  VaultPointerStore,
  VaultTarget,
} from "../server/ports";

/**
 * The doubles the server-half suites share.
 *
 * Deliberately hand-written rather than mocked modules: every one of these is
 * a PORT this package declares, so a fake that satisfies the interface is the
 * same proof an adopting host's implementation gets.
 */

export const MERCHANT: MerchantRef = { kind: "PLATFORM", id: "platform" };

export const TARGET: VaultTarget = {
  subscriptionId: "sub-1",
  customerRef: "cus-existing",
  customer: { name: "Legal Entity Ltd", email: "billing@example.test", taxId: "1234" },
};

export function fakeGateway(over: Partial<Record<string, unknown>> = {}) {
  return {
    charge: vi.fn(),
    beginVault: vi.fn(async () => ({
      provider: "acquirer-a",
      tokenization: "SDK",
      publicKey: "pk_test",
      clientSecret: "seti_secret",
      sessionId: "sess-1",
    })),
    completeVault: vi.fn(async () => ({
      provider: "acquirer-a",
      customerRef: "cus-existing",
      instrumentId: "pm-1",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    })),
    forgetVault: vi.fn(async () => undefined),
    ...over,
  };
}

export function fakePayments(gateway: ReturnType<typeof fakeGateway>, provider: string | null = "acquirer-a") {
  const credentials = { defaultProvider: vi.fn(async () => provider) };
  return {
    payments: vi.fn(async () => ({ gateway, credentials }) as unknown as BillingPayments),
    credentials,
  };
}

export function fakeDirectory(target: VaultTarget | null = TARGET): SubscriptionVaultDirectory & {
  findTarget: ReturnType<typeof vi.fn>;
} {
  return { findTarget: vi.fn(async () => target) };
}

interface FakeInstrumentStore extends VaultPointerStore {
  saved: SaveVaultedInstrument[];
  forgotten: string[];
}

export function fakeInstruments(
  pointers: readonly StoredVaultPointer[] = [],
  cards: readonly InstrumentCard[] = [],
): FakeInstrumentStore {
  const saved: SaveVaultedInstrument[] = [];
  const forgotten: string[] = [];
  return {
    saved,
    forgotten,
    save: async (instrument) => {
      saved.push(instrument);
    },
    listPointers: async () => pointers,
    forget: async (pointerId) => {
      forgotten.push(pointerId);
    },
    listCards: async () => cards,
  };
}
