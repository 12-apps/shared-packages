// @vitest-environment jsdom
/**
 * FUT-563 — the browser mints ONE instrument PER PROVIDER, so a card charge
 * can walk the merchant's chain.
 *
 * A card token is bound to whoever minted it: the gateway refuses to hand
 * provider #2 provider #1's blob and skips it instead. So the checkout's whole
 * contribution to failover is this — take the card the buyer typed ONCE, and
 * produce an instrument for each entry of the chain the server published.
 *
 * The scenarios the browser journey cannot reach live here: a chain entry with
 * no in-browser scheme (a hosted page needs no instrument), a chain the host
 * never published (an older server, or a fetch blip), and an entry whose
 * tokenization fails while the others succeed.
 */
import { describe, expect, it } from "vitest";

import { cardChain, cardPathAvailable, cardTokenization } from "../method-capability";
import type { CheckoutProviderConfig } from "../types";

function link(
  provider: string,
  tokenization: CheckoutProviderConfig["tokenization"],
  publicKey: string | null = null,
) {
  return {
    provider,
    tokenization: tokenization as "NONE" | "PUBLIC_KEY" | "SDK" | "REDIRECT",
    publicKey,
    mockTokenization: false,
    methods: ["PIX" as const, "CARD" as const],
  };
}

function config(over: Partial<CheckoutProviderConfig> = {}): CheckoutProviderConfig {
  return {
    provider: "pagbank",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_pagbank",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    ...over,
  };
}

describe("cardChain", () => {
  it("gives one tokenization config per entry, in the merchant's order", async () => {
    const chain = cardChain(
      config({
        chain: [link("pagbank", "PUBLIC_KEY", "pk_pagbank"), link("stone", "PUBLIC_KEY", "pk_stone")],
      }),
    );

    expect(chain.map((entry) => entry.provider)).toEqual(["pagbank", "stone"]);
    expect(chain.map((entry) => entry.publicKey)).toEqual(["pk_pagbank", "pk_stone"]);
  });

  it("marks entries with no in-browser scheme unmintable instead of dropping them", async () => {
    // A REDIRECT provider's own page takes the card, and a NONE one asks for no
    // instrument. Minting for either would produce a fake token under stub mode
    // and an error everywhere else — and the gateway passes an unattributed
    // charge straight through to them anyway.
    //
    // They stay in the LIST because the charge walks them: the card path counts
    // this list to decide whether `tokensByProvider` has to travel at all, and
    // a chain counted by "who minted" hides the hosted page from the server.
    const chain = cardChain(
      config({
        chain: [
          link("pagbank", "PUBLIC_KEY", "pk_pagbank"),
          link("infinitepay", "REDIRECT"),
          link("nothing", "NONE"),
        ],
      }),
    );

    expect(chain.map((entry) => entry.provider)).toEqual(["pagbank", "infinitepay", "nothing"]);
    expect(chain.map((entry) => entry.mintable)).toEqual([true, false, false]);
  });

  it("falls back to the HEAD alone when the host published no chain", async () => {
    // Exactly the pre-FUT-563 behaviour: one instrument, for the active
    // provider. A server that does not answer a chain must not break checkout.
    expect(cardChain(config())).toEqual([{ ...cardTokenization(config()), mintable: true }]);
  });

  it("has nothing to mint for a store with no provider at all", async () => {
    expect(cardChain(null)).toEqual([]);
  });

  it("never re-heads or reorders the merchant's list", async () => {
    // The storefront is a READER of the priority list. Preferring the entry
    // with a key, or sorting by anything, would silently override the order the
    // owner set and the plan ceiling already truncated.
    const chain = cardChain(
      config({
        provider: "stone",
        chain: [link("stone", "PUBLIC_KEY", null), link("pagbank", "PUBLIC_KEY", "pk_pagbank")],
      }),
    );

    expect(chain.map((entry) => entry.provider)).toEqual(["stone", "pagbank"]);
  });

  it("counts the whole chain, hosted entries included", async () => {
    // What `tokensByProvider`'s presence is decided on. A card acquirer plus a
    // hosted-page fallback is TWO providers the walk may reach, even though
    // only one of them is ever minted for.
    const chain = cardChain(
      config({ chain: [link("pagbank", "PUBLIC_KEY", "pk_pagbank"), link("infinitepay", "REDIRECT")] }),
    );

    expect(chain).toHaveLength(2);
    expect(chain.filter((entry) => entry.mintable)).toHaveLength(1);
  });
});

/**
 * FUT-563 — the picker and the SERVER must answer the same question.
 *
 * `usesHostedCheckout` asks the WHOLE chain whether anybody tokenizes in the
 * browser, so a REDIRECT head no longer means "the buyer is handed over". A
 * client that still read the head alone offered a card the submit could not
 * mint, and a store whose only mintable entry has no key offered one nobody
 * could pay.
 */
describe("cardPathAvailable", () => {
  it("offers CARD for a hosted-page store: its own site takes the card", async () => {
    expect(cardPathAvailable(config({ chain: [link("infinitepay", "REDIRECT")] }))).toBe(true);
  });

  it("offers CARD when a LATER entry can be minted for, not just the head", async () => {
    // The server shows our form for exactly this chain, so the picker must
    // agree — and the submit mints against the tail.
    const mixed = config({
      provider: "infinitepay",
      tokenization: "REDIRECT",
      publicKey: null,
      chain: [link("infinitepay", "REDIRECT"), link("pagbank", "PUBLIC_KEY", "pk_pagbank")],
    });

    expect(cardPathAvailable(mixed)).toBe(true);
  });

  it("refuses CARD when the only mintable entry has no key this browser can use", async () => {
    // Stone with no publishable key: the form would render and the submit
    // would die. Better a disabled tile that says so.
    const unusable = config({
      provider: "infinitepay",
      tokenization: "REDIRECT",
      publicKey: null,
      chain: [link("infinitepay", "REDIRECT"), link("stone", "PUBLIC_KEY", null)],
    });

    expect(cardPathAvailable(unusable)).toBe(false);
  });

  it("still fails OPEN while the config has not answered", async () => {
    expect(cardPathAvailable(null)).toBe(true);
  });
});
