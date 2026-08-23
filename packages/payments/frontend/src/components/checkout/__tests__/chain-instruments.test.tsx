// @vitest-environment jsdom
/**
 * FUT-563 — "o comprador digita o cartão UMA vez e a compra sobrevive ao
 * primeiro provedor falhar": the browser half of it.
 *
 * A card instrument is bound to the provider that minted it, so a chain the
 * checkout tokenized for only ONCE is a chain the gateway can attempt only
 * once — it skips the rest rather than send a blob they cannot read. What is
 * pinned here is that the same validated card produces one instrument per
 * chain entry and they all travel on ONE charge, with nothing re-typed.
 *
 * The browser journey (the `cadeia-de-provedores` Gherkin feature)
 * covers the happy path end to end; these are the halves it cannot stage — a
 * tail provider whose tokenization fails while the head's works, and a store
 * whose host published no chain at all.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX } from "react";

const client = vi.hoisted(() => ({
  chargeCard: vi.fn(),
  listSavedCards: vi.fn(),
  refreshCardPublicKey: vi.fn(),
  pollOrderStatus: vi.fn(),
  fetchCheckoutConfig: vi.fn(),
}));

vi.mock("../client", () => client);

import type { CardTokenizationConfig } from "../../../card";
import type { CardChainLink } from "../method-capability";
import type { CheckoutOrder } from "../types";
import { useCardCheckout } from "../use-card-checkout";

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 1250,
  subtotalCents: 1250,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 12,50",
};

/** Stub-mode entries: the mock tokenizer mints without a real key or network. */
const HEAD: CardChainLink = {
  provider: "pagbank",
  publicKey: null,
  mockTokenization: true,
  mintable: true,
};
const TAIL: CardChainLink = {
  provider: "stone",
  publicKey: null,
  mockTokenization: true,
  mintable: true,
};
/**
 * Declares an in-browser scheme, but this browser has none for it: no
 * tokenizer, no key, no mock grant. The mint FAILS — a different thing from
 * an entry that asks for no instrument.
 */
const UNMINTABLE: CardChainLink = {
  provider: "unknown-vendor",
  publicKey: null,
  mockTokenization: false,
  mintable: true,
};
/** A hosted page: its own site takes the card, so nothing is minted for it. */
const HOSTED: CardChainLink = {
  provider: "infinitepay",
  publicKey: null,
  mockTokenization: false,
  mintable: false,
};
/**
 * The ACTIVE provider of a hosted-headed store, as the config's head triple:
 * no scheme, no key, no stub grant. Nothing this browser can mint against.
 */
const HOSTED_HEAD: CardTokenizationConfig = {
  provider: "infinitepay",
  publicKey: null,
  mockTokenization: false,
};

const CARD = { number: "4111111111111111", holder: "VERA CADEIA", expiry: "12/34", cvv: "123" };

/**
 * Filling and paying are two BUTTONS, not one handler: `handlePay` closes over
 * the card in state, so a submit fired in the same tick as `setCard` validates
 * the empty form and never reaches the tokenizer.
 */
function Harness({
  chain,
  config = HEAD,
}: {
  chain: CardChainLink[];
  config?: CardTokenizationConfig;
}): JSX.Element {
  const cc = useCardCheckout(ORDER, {}, config, vi.fn(), 10, undefined, chain);
  return (
    <div>
      <button type="button" data-testid="fill" onClick={() => cc.setCard(CARD)}>
        Preencher
      </button>
      <button type="button" data-testid="pay" onClick={() => void cc.handlePay()}>
        Pagar
      </button>
      {cc.error ? <p data-testid="pay-error">{cc.error}</p> : null}
    </div>
  );
}

/** The `tokensByProvider` of the single charge submitted. */
function sentInstruments(): Record<string, string> | undefined {
  const input = client.chargeCard.mock.calls[0]?.[0] as
    | { tokensByProvider?: Record<string, string> }
    | undefined;
  return input?.tokensByProvider;
}

async function payWith(chain: CardChainLink[], config?: CardTokenizationConfig): Promise<void> {
  render(<Harness chain={chain} config={config} />);
  await waitFor(() => {
    expect(client.listSavedCards).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByTestId("fill"));
  fireEvent.click(screen.getByTestId("pay"));
  await waitFor(() => {
    expect(client.chargeCard).toHaveBeenCalled();
  });
}

/** Fill + tap Pagar, then prove the submit never reached the charge route. */
async function expectNoCharge(
  chain: CardChainLink[],
  config?: CardTokenizationConfig,
): Promise<void> {
  render(<Harness chain={chain} config={config} />);
  await waitFor(() => {
    expect(client.listSavedCards).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByTestId("fill"));
  fireEvent.click(screen.getByTestId("pay"));
  // The refusal is what ends the submit, so waiting for it is what proves the
  // charge was skipped rather than merely still in flight.
  await waitFor(() => {
    expect(screen.getByTestId("pay-error").textContent).toMatch(/indisponível nesta loja/i);
  });
  expect(client.chargeCard).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listSavedCards.mockResolvedValue([]);
  // The head is PagBank with no key, so the hook's on-demand key refresh runs
  // on mount (FUT-174). It finds none here — stub mode is what mints the token.
  client.refreshCardPublicKey.mockResolvedValue({ ok: true, data: { publicKey: null } });
  client.pollOrderStatus.mockResolvedValue({ ok: true, data: "AWAITING_PAYMENT" });
  client.chargeCard.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } });
});

afterEach(() => {
  cleanup();
});

describe("one instrument per provider (FUT-563)", () => {
  it("mints for EVERY entry of the chain from one typed card", async () => {
    await payWith([HEAD, TAIL]);

    const minted = sentInstruments();
    expect(Object.keys(minted ?? {}).sort()).toEqual(["pagbank", "stone"]);
    // Distinct instruments: one blob reused across providers is the exact
    // thing the gateway refuses to send.
    expect(minted?.["pagbank"]).not.toBe(minted?.["stone"]);
    // The buyer typed once.
    expect(client.chargeCard).toHaveBeenCalledTimes(1);
  });

  it("keeps the head's own token as the bare `token`", async () => {
    await payWith([HEAD, TAIL]);

    const input = client.chargeCard.mock.calls[0]?.[0] as { token: string };
    expect(sentInstruments()?.["pagbank"]).toBe(input.token);
  });

  it("still pays when a TAIL provider cannot be tokenized for", async () => {
    // That provider is one the walk will skip — strictly better than failing
    // the whole payment because the second acquirer's key was missing. The map
    // still travels, naming who DID mint: the server then skips the tail by
    // name instead of reading the bare token as the head's and skipping
    // everyone else.
    await payWith([HEAD, UNMINTABLE]);

    expect(sentInstruments()).toEqual({ pagbank: expect.any(String) });
    expect(client.chargeCard).toHaveBeenCalledTimes(1);
  });

  it("sends the map when the TAIL is a provider that needs NO instrument", async () => {
    // The two-provider shape this feature exists for: a card acquirer plus a
    // hosted-page fallback. Nothing is minted for the hosted entry — its own
    // site takes the card — so a map counted by minted keys would be dropped,
    // the bare token read as the head's, and the fallback refused for
    // "holding someone else's instrument". The chain has TWO entries, so the
    // map goes.
    await payWith([HEAD, HOSTED]);

    expect(sentInstruments()).toEqual({ pagbank: expect.any(String) });
    // And never a mocked one for the hosted provider.
    expect(sentInstruments()).not.toHaveProperty("infinitepay");
  });

  it("mints against the first MINTABLE entry when the HEAD is a hosted page", async () => {
    // The store this feature creates by simply enabling a second provider:
    // InfinitePay (REDIRECT) first, an acquirer behind it. The server asks the
    // WHOLE chain whether anybody tokenizes in the browser, so it shows our
    // card form — and the submit must mint against the entry the form is being
    // shown FOR. Minting against the head refused the payment outright, with a
    // full PAN already typed and no provider ever asked.
    await payWith([HOSTED, HEAD], HOSTED_HEAD);

    expect(client.chargeCard).toHaveBeenCalledTimes(1);
    expect(sentInstruments()).toEqual({ pagbank: expect.any(String) });
    // The bare token is the one that was actually minted, not the head's.
    const input = client.chargeCard.mock.calls[0]?.[0] as { token: string };
    expect(input.token).toBe(sentInstruments()?.["pagbank"]);
  });

  it("still refuses when NO entry of the chain can be minted for", async () => {
    // Nothing to fall back to — the buyer is told so before any charge, which
    // is the honest answer and the one FUT-697 wrote.
    await expectNoCharge([HOSTED, UNMINTABLE], HOSTED_HEAD);
  });

  it("sends no map at all for a single-provider store", async () => {
    // The pre-FUT-563 wire shape, unchanged: one token, no map.
    await payWith([HEAD]);

    expect(sentInstruments()).toBeUndefined();
  });
});
