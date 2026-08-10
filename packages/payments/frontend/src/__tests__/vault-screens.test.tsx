// @vitest-environment jsdom
/**
 * The buyer-vault screens (FUT-183) against a REAL `createPaymentFlowsBE`
 * mount — `screens.AddCard` and `screens.ManageCards` over FUT-478's
 * `POST /cards/begin` + `POST /cards/complete`.
 *
 * Same rule as the factory suite: neither side is mocked. The screens call the
 * shipped client, the client posts into a live mount, and the mount runs the
 * real gateway with a vendor-free vaulting adapter behind it. What is pinned:
 *
 *   - the order of the flow (begin equips → the browser tokenizes → complete
 *     stores) and that the browser contributes ONLY its two facts;
 *   - the saved state shows display metadata and NEVER the vault token;
 *   - a refused complete surfaces the endpoint's field-level reason and keeps
 *     the form editable;
 *   - a store that cannot vault says so up front and never collects a card;
 *   - both screens render through the host's design-system slots.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCheckoutClient } from "../components/checkout/transport";
import type { CheckoutComponents } from "../components/checkout/ui";
import { storyFlows } from "../stories/host";
import type { StorySpec } from "../stories/store";

afterEach(cleanup);

/** A store whose chain head can vault, on the server-granted stub tokenizer. */
const VAULTABLE: StorySpec = {
  chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null, vaultable: true }],
};

/** Fill the shared card form with a PAN the stub tokenizer accepts. */
function fillCard(): void {
  fireEvent.change(screen.getByTestId("card-number"), {
    target: { value: "4111 1111 1111 1111" },
  });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA COMPRADORA" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/34" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
}

describe("screens.AddCard — the happy path", () => {
  it("given a vaultable store, when the buyer saves a card, then begin → tokenize → complete run in order and the display renders", async () => {
    const onSaved = vi.fn();
    const { flows, world } = storyFlows(VAULTABLE);
    render(<flows.screens.AddCard onSaved={onSaved} />);

    await waitFor(() => expect(screen.getByTestId("add-card-save")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("add-card-save"));
    await waitFor(() => expect(screen.getByTestId("add-card-saved")).toBeTruthy());

    // `begin` ran under the HOST's ownership facts — never the browser's.
    expect(world.vaultCalls.begin).toHaveLength(1);
    expect(world.vaultCalls.begin[0]?.reference).toBe("vault_buyer-1");
    // `complete` got the browser's two legitimate facts — the echoed session
    // and the freshly minted token — beside the host-derived reference.
    expect(world.vaultCalls.complete).toHaveLength(1);
    expect(world.vaultCalls.complete[0]).toMatchObject({
      reference: "vault_buyer-1",
      sessionId: "vs_aurora_1",
    });
    expect(world.vaultCalls.complete[0]?.token).toMatch(/^tok_/);
    // The instrument reached the HOST's storage, scoped to the minting provider.
    expect(world.vaulted).toEqual([
      {
        provider: "aurora",
        token: "vault_tok_vault_buyer-1",
        display: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2031 },
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2031 });
  });

  it("given the card is saved, when the confirmation renders, then it shows brand and last4 and never the vault token", async () => {
    const { flows, world } = storyFlows(VAULTABLE);
    render(<flows.screens.AddCard />);

    await waitFor(() => expect(screen.getByTestId("add-card-save")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("add-card-save"));
    await waitFor(() => expect(screen.getByTestId("add-card-saved")).toBeTruthy());

    const rendered = document.body.textContent ?? "";
    expect(rendered).toContain("Cartão salvo");
    expect(rendered).toContain("visa •••• 4242");
    expect(rendered).toContain("Validade 12/2031");
    // Neither the vault token the host stored nor the browser-minted token is
    // on the page — the display is metadata only.
    expect(rendered).not.toContain(world.vaulted[0]?.token ?? "vault_tok_");
    expect(rendered).not.toContain(world.vaultCalls.complete[0]?.token ?? "tok_");
  });
});

describe("screens.AddCard — refusals", () => {
  it("given the provider refuses the card at complete, when the buyer saves, then the endpoint's reason renders and the form stays editable", async () => {
    const { flows, world } = storyFlows({
      chain: [
        {
          name: "aurora",
          methods: ["CARD"],
          stub: true,
          publicKey: null,
          vaultable: true,
          vaultDeclines: true,
        },
      ],
    });
    render(<flows.screens.AddCard />);

    await waitFor(() => expect(screen.getByTestId("add-card-save")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("add-card-save"));
    await waitFor(() => expect(screen.getByTestId("add-card-error")).toBeTruthy());

    // The host-mapped field-level reason, not a generic sentence.
    expect(document.body.textContent).toContain(
      "O cartão foi recusado. Confira o número e tente novamente.",
    );
    // Nothing reached the host's storage.
    expect(world.vaulted).toEqual([]);
    // The form is still on screen and still editable — the buyer fixes the
    // card in place rather than starting over.
    fireEvent.change(screen.getByTestId("card-number"), {
      target: { value: "5555 5555 5555 4444" },
    });
    expect((screen.getByTestId("card-number") as HTMLInputElement).value).toBe(
      "5555 5555 5555 4444",
    );
    expect(screen.getByTestId("add-card-save")).toBeTruthy();
  });

  it("given a provider with no vault seam, when the screen mounts, then the unavailable state renders and no card is ever collected", async () => {
    const { flows, world } = storyFlows({
      chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null }],
    });
    render(<flows.screens.AddCard />);

    await waitFor(() => expect(screen.getByTestId("add-card-unavailable")).toBeTruthy());
    expect(document.body.textContent).toContain(
      "Esta loja não aceita salvar cartões no momento.",
    );
    // No form ⇒ nothing to tokenize, and the mount's complete was never asked.
    await waitFor(() => expect(screen.queryByTestId("card-number")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("add-card-save")).toBeNull());
    expect(world.vaultCalls.begin).toEqual([]);
    expect(world.vaultCalls.complete).toEqual([]);
  });

  it("given a store with no connected provider, when the screen mounts, then the host-worded not-configured sentence renders", async () => {
    const { flows } = storyFlows({ chain: [] });
    render(<flows.screens.AddCard />);

    await waitFor(() => expect(screen.getByTestId("add-card-unavailable")).toBeTruthy());
    // 409 PAYMENT_NOT_CONFIGURED already carries the host copy's pt-BR — the
    // screen shows it verbatim rather than substituting its own.
    expect(document.body.textContent).toContain(
      "Esta loja não está aceitando pagamentos online no momento.",
    );
  });
});

describe("screens.ManageCards", () => {
  it("given no cards on file, when the screen settles, then the empty-state copy and the add door render", async () => {
    const { flows } = storyFlows(VAULTABLE);
    render(<flows.screens.ManageCards />);

    await waitFor(() => expect(screen.getByTestId("manage-cards-empty")).toBeTruthy());
    expect(document.body.textContent).toContain("Meus cartões");
    expect(document.body.textContent).toContain("Você ainda não tem cartões salvos.");
    expect(screen.getByTestId("manage-cards-add")).toBeTruthy();
  });

  it("given cards on file, when the screen settles, then each instrument renders its display metadata", async () => {
    const { flows } = storyFlows({
      ...VAULTABLE,
      instruments: [
        { id: "card_1", last4: "4242", brand: "visa", expMonth: 4, expYear: 2030 },
        { id: "card_2", last4: "0005", brand: "mastercard" },
      ],
    });
    render(<flows.screens.ManageCards />);

    await waitFor(() => expect(screen.getByTestId("manage-cards-list")).toBeTruthy());
    expect(screen.getByTestId("manage-cards-item-card_1").textContent).toContain("visa •••• 4242");
    expect(screen.getByTestId("manage-cards-item-card_1").textContent).toContain("Validade 04/2030");
    expect(screen.getByTestId("manage-cards-item-card_2").textContent).toContain(
      "mastercard •••• 0005",
    );
    await waitFor(() => expect(screen.queryByTestId("manage-cards-empty")).toBeNull());
  });

  it("given the buyer wants another card, when they press Adicionar cartão, then the whole add flow runs inside the screen", async () => {
    const { flows, world } = storyFlows(VAULTABLE);
    render(<flows.screens.ManageCards />);

    await waitFor(() => expect(screen.getByTestId("manage-cards-add")).toBeTruthy());
    fireEvent.click(screen.getByTestId("manage-cards-add"));

    // The add form opened in place…
    await waitFor(() => expect(screen.getByTestId("add-card")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("add-card-save"));
    // …and saving through it stores the instrument, exactly as standalone.
    await waitFor(() => expect(screen.getByTestId("add-card-saved")).toBeTruthy());
    expect(world.vaulted).toHaveLength(1);
  });
});

describe("the design-system slots", () => {
  /** One slot, filled with markup no MUI default produces — the ownership tell. */
  const hostComponents: Partial<CheckoutComponents> = {
    Button: ({ children, onClick, disabled, dataTestId }) => (
      <button
        type="button"
        data-testid={dataTestId}
        data-host-slot="button"
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    ),
  };

  it("given a host slot table, when AddCard renders, then its action is the host's button", async () => {
    const { flows } = storyFlows(VAULTABLE, { components: hostComponents });
    render(<flows.screens.AddCard />);

    await waitFor(() => expect(screen.getByTestId("add-card-save")).toBeTruthy());
    expect(screen.getByTestId("add-card-save").getAttribute("data-host-slot")).toBe("button");
  });

  it("given a host slot table, when ManageCards renders, then its action is the host's button", async () => {
    const { flows } = storyFlows(VAULTABLE, { components: hostComponents });
    render(<flows.screens.ManageCards />);

    await waitFor(() => expect(screen.getByTestId("manage-cards-add")).toBeTruthy());
    expect(screen.getByTestId("manage-cards-add").getAttribute("data-host-slot")).toBe("button");
  });
});

describe("the transport pair", () => {
  it("given the bound client, when the vault pair runs, then it posts the published /cards routes and answers the wire shapes", async () => {
    const { world } = storyFlows(VAULTABLE);
    const urls: string[] = [];
    const recording = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      urls.push(String(input));
      return world.fetchImpl(input, init);
    };
    const client = createCheckoutClient({ fetchImpl: recording as typeof fetch });

    const begun = await client.beginVault();
    expect(begun).toEqual({
      ok: true,
      data: {
        provider: "aurora",
        tokenization: "PUBLIC_KEY",
        publicKey: null,
        clientSecret: null,
        sessionId: "vs_aurora_1",
      },
    });

    const completed = await client.completeVault({ sessionId: "vs_aurora_1", token: "tok_wire_1" });
    expect(completed).toEqual({
      ok: true,
      data: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2031 },
    });

    // The published prefix, verbatim — no re-derivation, no normalization.
    expect(urls).toEqual(["/api/checkout/cards/begin", "/api/checkout/cards/complete"]);
    // And the wire really carried the browser's two facts to the adapter seam.
    expect(world.vaultCalls.complete[0]).toMatchObject({
      sessionId: "vs_aurora_1",
      token: "tok_wire_1",
    });
  });
});
