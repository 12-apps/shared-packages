// @vitest-environment jsdom
/**
 * FUT-563 — a BACKUP acquirer nobody can reach must not hold the payment.
 *
 * Minting one instrument per chain entry puts the buyer's Pagar button behind
 * every acquirer in the chain, and a tokenizer is a cross-origin POST with no
 * deadline of its own — browser `fetch` has none either. A middlebox that
 * accepts the socket and never answers therefore left "Pagar R$ …" spinning
 * and disabled for as long as the OS kept the connection: the failover feature
 * blocking on the provider it exists to fall back TO, with the head's own
 * token already minted and nothing wrong with it.
 *
 * These are the halves the browser journey cannot stage — it has no way to
 * make an acquirer stop answering.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveNewCardToken } from "../card-instruments";
import type { CardChainLink } from "../method-capability";
import { PT_BR_CARD_COPY } from "../../../card/pt-BR";

vi.mock("../client", () => ({ refreshCardPublicKey: vi.fn() }));

const CARD = { number: "4111111111111111", holder: "VERA CADEIA", expiry: "12/34", cvv: "123" };

/** Stub mode: the head mints locally, with no network and no key. */
const HEAD: CardChainLink = {
  provider: "pagbank",
  publicKey: null,
  mockTokenization: true,
  mintable: true,
};
/** A real Pagar.me tokenizer — this one goes to the network. */
const STONE: CardChainLink = {
  provider: "stone",
  publicKey: "pk_stone",
  mockTokenization: false,
  mintable: true,
};
/** A real Stripe tokenizer — likewise. */
const STRIPE: CardChainLink = {
  provider: "stripe",
  publicKey: "pk_stripe",
  mockTokenization: false,
  mintable: true,
};

/** A tokenizer endpoint that accepts the request and never answers. */
function blackHole(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("minting the chain is bounded and concurrent", () => {
  it("charges on the head when a TAIL acquirer never answers", async () => {
    const fetchMock = blackHole();

    const resolved = await resolveNewCardToken(
      CARD,
      HEAD,
      "o1",
      vi.fn(),
      false,
      [HEAD, STONE],
      PT_BR_CARD_COPY,
      20,
    );

    // The degradation this module already documents: the provider we could not
    // mint for is one the walk will skip. The payment still goes out.
    expect(resolved.ok).toBe(true);
    const instruments = resolved.ok ? resolved.data : null;
    expect(instruments?.tokensByProvider).toEqual({ pagbank: expect.any(String) });
    // And the abandoned request is ABORTED, not merely ignored — a token that
    // arrives after we gave up on it is one nothing will ever charge.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal?.aborted).toBe(true);
  });

  it("asks every tail at ONCE, not one after the other", async () => {
    // Sequentially, two unreachable backups cost the buyer two full deadlines
    // before a charge they could have had immediately.
    const fetchMock = blackHole();
    const deadlineMs = 400;

    const minting = resolveNewCardToken(
      CARD,
      HEAD,
      "o1",
      vi.fn(),
      false,
      [HEAD, STONE, STRIPE],
      PT_BR_CARD_COPY,
      deadlineMs,
    );
    // Both requests are in flight well inside ONE deadline — which they could
    // not be if the second waited for the first to time out.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const resolved = await minting;
    expect(resolved.ok).toBe(true);
  });
});
