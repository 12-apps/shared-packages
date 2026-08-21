// @vitest-environment node
/**
 * The card-on-file flow (FUT-340).
 *
 * Two properties are worth more than the rest and are pinned first: nothing
 * below has a parameter a card could travel in, and the `reference` handed to
 * the provider comes from the host's own subscription row rather than from the
 * request. The second is the whole of what stops one owner completing a
 * stranger's vault session.
 */
import { describe, expect, it } from "vitest";

import { ProviderRequestError, UnsupportedOperationError } from "@12-apps/payments-backend";

import { createCardVault } from "../server/vault";
import type { StoredVaultPointer } from "../server/ports";
import {
  MERCHANT,
  TARGET,
  fakeDirectory,
  fakeGateway,
  fakeInstruments,
  fakePayments,
} from "./fixtures";

function vault(options: {
  gateway?: ReturnType<typeof fakeGateway>;
  provider?: string | null;
  enabled?: boolean;
  target?: typeof TARGET | null;
  instruments?: ReturnType<typeof fakeInstruments>;
} = {}) {
  const gateway = options.gateway ?? fakeGateway();
  const { payments } = fakePayments(gateway, options.provider === undefined ? "acquirer-a" : options.provider);
  const subscriptions = fakeDirectory(options.target === undefined ? TARGET : options.target);
  const instruments = options.instruments ?? fakeInstruments();
  return {
    gateway,
    subscriptions,
    instruments,
    vault: createCardVault({
      payments,
      merchant: MERCHANT,
      enabled: async () => options.enabled ?? true,
      subscriptions,
      instruments,
    }),
  };
}

describe("the three refusals that are not exceptions", () => {
  it("refuses when the deployment cannot collect at all", async () => {
    const { vault: cards, gateway } = vault({ enabled: false });
    await expect(cards.begin("owner-1")).resolves.toEqual({
      ok: false,
      rejection: "no-platform-account",
    });
    // Checked FIRST and EARLY: nothing reached the provider.
    expect(gateway.beginVault).not.toHaveBeenCalled();
  });

  it("refuses when no provider is enabled in the chain", async () => {
    const { vault: cards } = vault({ provider: null });
    await expect(cards.begin("owner-1")).resolves.toEqual({
      ok: false,
      rejection: "no-platform-account",
    });
  });

  it("refuses when the owner has no subscription to attach a card to", async () => {
    const { vault: cards } = vault({ target: null });
    await expect(cards.begin("owner-1")).resolves.toEqual({
      ok: false,
      rejection: "no-subscription",
    });
  });

  it("reports a provider that cannot vault as a state of the world", async () => {
    // An operator fixes this by switching acquirer; it is not an error the
    // owner caused, so it must not surface as one.
    const gateway = fakeGateway({
      beginVault: async () => {
        throw new UnsupportedOperationError("acquirer-a", "saving a card");
      },
    });
    const { vault: cards } = vault({ gateway });
    await expect(cards.begin("owner-1")).resolves.toEqual({
      ok: false,
      rejection: "provider-cannot-vault",
    });
  });

  it("lets any other provider failure through — it is not a rejection", async () => {
    const gateway = fakeGateway({
      beginVault: async () => {
        throw new ProviderRequestError("acquirer-a", "boom", { httpStatus: 500 });
      },
    });
    const { vault: cards } = vault({ gateway });
    await expect(cards.begin("owner-1")).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

describe("begin", () => {
  it("stamps the subscription id as the reference and reuses the customer", async () => {
    const { vault: cards, gateway } = vault();
    const result = await cards.begin("owner-1");

    expect(gateway.beginVault).toHaveBeenCalledWith(MERCHANT, {
      reference: TARGET.subscriptionId,
      customer: TARGET.customer,
      customerRef: TARGET.customerRef,
    });
    expect(result).toEqual({
      ok: true,
      start: {
        provider: "acquirer-a",
        tokenization: "SDK",
        publicKey: "pk_test",
        clientSecret: "seti_secret",
        sessionId: "sess-1",
      },
    });
  });

  it("normalises every absent field to null rather than dropping it", async () => {
    // The browser reads this shape; a missing key and an explicitly absent one
    // are different bugs to diagnose.
    const gateway = fakeGateway({
      beginVault: async () => ({ provider: "acquirer-a", tokenization: "PUBLIC_KEY" }),
    });
    const { vault: cards } = vault({ gateway });
    const result = await cards.begin("owner-1");
    expect(result).toEqual({
      ok: true,
      start: {
        provider: "acquirer-a",
        tokenization: "PUBLIC_KEY",
        publicKey: null,
        clientSecret: null,
        sessionId: null,
      },
    });
  });
});

describe("complete", () => {
  it("passes a reference resolved from the row, never one echoed from the request", async () => {
    // THE anti-substitution property. The session id is attacker-controlled;
    // the reference is not, and the adapter compares them.
    const { vault: cards, gateway } = vault();
    await cards.complete("owner-1", "sess-from-browser");

    expect(gateway.completeVault).toHaveBeenCalledWith(MERCHANT, {
      sessionId: "sess-from-browser",
      reference: TARGET.subscriptionId,
      customerRef: TARGET.customerRef,
    });
  });

  it("persists exactly what the provider handed back", async () => {
    const { vault: cards, instruments } = vault();
    await expect(cards.complete("owner-1", "sess-1")).resolves.toEqual({ ok: true });

    expect(instruments.saved).toEqual([
      {
        ownerId: "owner-1",
        subscriptionId: "sub-1",
        provider: "acquirer-a",
        providerCustomerId: "cus-existing",
        providerInstrumentId: "pm-1",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      },
    ]);
  });

  it("stores nothing when the deployment cannot collect", async () => {
    const { vault: cards, instruments } = vault({ enabled: false });
    await expect(cards.complete("owner-1", "sess-1")).resolves.toEqual({
      ok: false,
      rejection: "no-platform-account",
    });
    expect(instruments.saved).toEqual([]);
  });
});

describe("forgetAll", () => {
  /** Two acquirers' worth of pointers, fresh per assertion. */
  function pointers(): StoredVaultPointer[] {
    return [
      { id: "row-today", provider: "acquirer-a", providerCustomerId: "cus-1", providerInstrumentId: "pm-1" },
      { id: "row-yesterday", provider: "acquirer-b", providerCustomerId: null, providerInstrumentId: "pm-0" },
    ];
  }

  it("is idempotent when nothing is on file", async () => {
    // An owner with no card has already arrived where the call was going, and
    // a 404 for that would be a lie.
    const { vault: cards, gateway } = vault();
    await expect(cards.forgetAll("owner-1")).resolves.toEqual({ ok: true });
    expect(gateway.forgetVault).not.toHaveBeenCalled();
  });

  it("detaches EVERY pointer, not the one a screen would show", async () => {
    // A card at yesterday's acquirer is still a card on file, chargeable again
    // the day someone switches the acquirer back.
    const instruments = fakeInstruments(pointers());
    const { vault: cards, gateway } = vault({ instruments });

    await expect(cards.forgetAll("owner-1")).resolves.toEqual({ ok: true });
    expect(gateway.forgetVault).toHaveBeenCalledTimes(2);
    expect(gateway.forgetVault).toHaveBeenNthCalledWith(1, MERCHANT, "acquirer-a", {
      instrumentId: "pm-1",
      customerRef: "cus-1",
    });
    expect(gateway.forgetVault).toHaveBeenNthCalledWith(2, MERCHANT, "acquirer-b", {
      instrumentId: "pm-0",
      customerRef: undefined,
    });
    expect(instruments.forgotten).toEqual(["row-today", "row-yesterday"]);
  });

  it("drops the row anyway when the provider's refusal is final", async () => {
    // It is the POINTER that makes a charge possible, and the owner asked to
    // stop being charged; residue at the provider's end is the lesser harm.
    const gateway = fakeGateway({
      forgetVault: async () => {
        throw new ProviderRequestError("acquirer-a", "no such instrument", {
          httpStatus: 404,
          retriable: false,
        });
      },
    });
    const instruments = fakeInstruments(pointers().slice(0, 1));
    const { vault: cards } = vault({ gateway, instruments });

    await expect(cards.forgetAll("owner-1")).resolves.toEqual({ ok: true });
    expect(instruments.forgotten).toEqual(["row-today"]);
  });

  it("keeps the row when a retry could plausibly clear the failure", async () => {
    // Losing the only handle on a stored card costs more than a second click.
    const gateway = fakeGateway({
      forgetVault: async () => {
        throw new ProviderRequestError("acquirer-a", "gateway timeout", {
          httpStatus: 504,
          retriable: true,
        });
      },
    });
    const instruments = fakeInstruments(pointers());
    const { vault: cards } = vault({ gateway, instruments });

    await expect(cards.forgetAll("owner-1")).resolves.toEqual({ ok: false });
    expect(instruments.forgotten).toEqual([]);
  });
});
