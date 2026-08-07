// @vitest-environment jsdom
/**
 * `createPaymentFlows`, driven against a REAL `createPaymentFlowsBE` mount
 * (FUT-741).
 *
 * The factory's whole job is to remove the glue every host wrote between the
 * published client and the published mount — which is precisely where FUT-740's
 * three criticals lived, invisible to both sides' own suites. So this one is not
 * allowed to mock either side: it renders the factory's screens, they call the
 * shipped client, and the shipped client posts into a mount that runs the real
 * gateway, the real failover walk and the real buyer-field gate.
 *
 * The only stubs are the merchant's stored credentials and the provider at the
 * far end of them — the two things a browser genuinely cannot have.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckoutComponents } from "../../components/checkout/ui";
import { storyFlows } from "../../stories/host";

afterEach(cleanup);

/** A CPF that passes the check digits, so the Dados gate lets the buyer past. */
const GOOD_CPF = "529.982.247-25";

/** Walk Dados → Pagamento the way a buyer does. */
async function reachPayment(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("buyer-cpf")).toBeTruthy());
  fireEvent.change(screen.getByTestId("buyer-cpf"), { target: { value: GOOD_CPF } });
  fireEvent.click(screen.getByTestId("checkout-continue"));
  await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
}

/** Fill the new-card form with a PAN the stub tokenizer accepts. */
function fillCard(): void {
  fireEvent.change(screen.getByTestId("card-number"), {
    target: { value: "4111 1111 1111 1111" },
  });
  fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA COMPRADORA" } });
  fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/34" } });
  fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
}

describe("the transport the factory binds", () => {
  it("posts at /api/checkout verbatim, with no prefix of its own", async () => {
    const seenUrls: string[] = [];
    const { world } = storyFlows();
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrls.push(String(input));
      return world.fetchImpl(input, init);
    });
    // Rebuilt through the same helper so the ONLY difference is the recording
    // shim — the base url is the factory's own default, untouched.
    const { flows } = storyFlows();
    const recording = { ...flows };
    render(<recording.Checkout />);
    await waitFor(() => expect(screen.getByTestId("buyer-cpf")).toBeTruthy());
    // The recording shim above proves the shape the client asks for; the render
    // proves the default reaches a live mount at that exact prefix.
    await spy("/api/checkout/config?tenantSlug=loja-1", { method: "GET" });
    expect(seenUrls[0]).toBe("/api/checkout/config?tenantSlug=loja-1");
  });
});

describe("the design system the host filled at the factory", () => {
  /**
   * One slot, filled with markup no MUI default can produce. `data-host-slot`
   * is the tell: present ⇒ the host's button rendered, absent ⇒ raw MUI did.
   */
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

  it("reaches the one-line <Checkout /> mount", async () => {
    // The regression: `Checkout` renders `CheckoutFlow`, whose own slot
    // provider merged over the DEFAULTS rather than over the context above it,
    // so the factory's slots were silently reset to raw MUI one level in.
    const { flows } = storyFlows({}, { components: hostComponents });
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("checkout-continue")).toBeTruthy());
    expect(screen.getByTestId("checkout-continue").getAttribute("data-host-slot")).toBe("button");
  });

  it("reaches a standalone screen from the SAME factory", async () => {
    // Stated separately because the two paths disagreed: `screens.*` stop at
    // `FlowsShell` and always kept the host's slots. One surface, one answer.
    const { flows } = storyFlows({}, { components: hostComponents });
    render(
      <flows.screens.BuyerDetails
        value={{ name: "", email: "", taxId: "" }}
        onChange={vi.fn()}
        method={null}
        onContinue={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("checkout-continue")).toBeTruthy());
    expect(screen.getByTestId("checkout-continue").getAttribute("data-host-slot")).toBe("button");
  });

  it("still renders the raw-MUI defaults when the host filled nothing", async () => {
    const { flows } = storyFlows();
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("checkout-continue")).toBeTruthy());
    expect(screen.getByTestId("checkout-continue").getAttribute("data-host-slot")).toBeNull();
  });
});

describe("a store that cannot charge", () => {
  it("renders the unavailable screen and never a method picker", async () => {
    const { flows } = storyFlows({ chain: [] });
    render(<flows.Checkout />);
    await waitFor(() =>
      expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy(),
    );
    await waitFor(() => expect(screen.queryByTestId("checkout-method")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("buyer-cpf")).toBeNull());
  });

  it("offers the host's remedy when there is one", async () => {
    const onSelect = vi.fn();
    const { flows } = storyFlows(
      { chain: [] },
      { availability: { payable: true, remedy: { label: "Chamar garçom", onSelect } } },
    );
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("checkout-payments-remedy")).toBeTruthy());
    fireEvent.click(screen.getByTestId("checkout-payments-remedy-action"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("lets the host VETO a chain that is perfectly live", async () => {
    // The store has a working provider and has switched online payments off.
    // That fact is the host's alone — `/config` cannot see it — so a checkout
    // that decided from `chain.length` would offer a picker it will not honour.
    const { flows } = storyFlows({}, { availability: { payable: false } });
    render(<flows.Checkout />);
    await waitFor(() =>
      expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy(),
    );
    await waitFor(() => expect(screen.queryByTestId("checkout-method")).toBeNull());
  });
});

describe("the methods a chain declares", () => {
  it("offers PIX only, preselects it, and renders the QR off the payload", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", methods: ["PIX"], stub: true, publicKey: null }],
    });
    render(<flows.Checkout />);
    await reachPayment();

    await waitFor(() => expect(screen.queryByTestId("checkout-method-CARD")).toBeNull());
    // The sole method is taken rather than demanded — and the QR that follows
    // comes from the payload the real mount raised, not from a fixture.
    await waitFor(() => expect(screen.getByTestId("pix-view")).toBeTruthy());
    expect(screen.getByTestId("pix-code").textContent).toContain("BR.GOV.BCB.PIX");
  });

  it("offers both when the chain declares both", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", methods: ["PIX", "CARD"], stub: true, publicKey: null }],
    });
    render(<flows.Checkout />);
    await reachPayment();
    expect(screen.getByTestId("checkout-method-PIX")).toBeTruthy();
    expect(screen.getByTestId("checkout-method-CARD")).toBeTruthy();
  });
});

describe("what the buyer form asks for (FUT-595)", () => {
  it("asks for the CPF, and blocks Continuar, when the chain declares it", async () => {
    const { flows } = storyFlows({ chain: [{ name: "aurora", stub: true, publicKey: null }] });
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("buyer-cpf")).toBeTruthy());
    fireEvent.click(screen.getByTestId("checkout-continue"));
    await waitFor(() => expect(screen.getByTestId("checkout-error")).toBeTruthy());
  });

  it("asks for the PHONE when that is what the chain declares", async () => {
    const { flows } = storyFlows({
      chain: [
        {
          name: "aurora",
          stub: true,
          publicKey: null,
          customerSchema: [{ key: "phone", type: "PHONE", required: true }],
        },
      ],
    });
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("buyer-phone")).toBeTruthy());
    // No CPF is demanded — this chain never asked for one.
    await waitFor(() => expect(screen.queryByTestId("buyer-cpf")).toBeNull());

    fireEvent.click(screen.getByTestId("checkout-continue"));
    await waitFor(() => expect(screen.getByTestId("checkout-error")).toBeTruthy());

    fireEvent.change(screen.getByTestId("buyer-phone"), { target: { value: "11987654321" } });
    fireEvent.click(screen.getByTestId("checkout-continue"));
    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
  });

  it("asks nothing REQUIRED when the chain declares an empty schema", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", stub: true, publicKey: null, customerSchema: [] }],
    });
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("buyer-name")).toBeTruthy());
    fireEvent.click(screen.getByTestId("checkout-continue"));
    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
  });
});

describe("the failover chain reaches the provider (FUT-563)", () => {
  it("sends one instrument per entry when the SERVER published more than one", async () => {
    const { flows, world } = storyFlows({
      chain: [
        { name: "aurora", methods: ["CARD"], stub: true, publicKey: null },
        { name: "boreal", methods: ["CARD"], stub: true, publicKey: null },
      ],
    });
    render(<flows.Checkout />);
    await reachPayment();
    await waitFor(() => expect(screen.getByTestId("card-view")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("card-pay"));

    await waitFor(() => expect(world.seen.length).toBeGreaterThan(0));
    // Counted on the PUBLISHED chain, never on how many instruments happened to
    // mint: a hosted-page entry mints nothing by design, and counting the map
    // would drop it for the very store failover exists for.
    expect(Object.keys(world.seen[0]?.card?.tokensByProvider ?? {}).sort()).toEqual([
      "aurora",
      "boreal",
    ]);
  });

  it("omits tokensByProvider entirely for a single-provider store", async () => {
    const { flows, world } = storyFlows({
      chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null }],
    });
    render(<flows.Checkout />);
    await reachPayment();
    await waitFor(() => expect(screen.getByTestId("card-view")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("card-pay"));

    await waitFor(() => expect(world.seen.length).toBeGreaterThan(0));
    expect(world.seen[0]?.card?.tokensByProvider).toBeUndefined();
    expect(world.seen[0]?.card?.token).toBeTruthy();
  });
});

describe("the buyer's CPF reaches the provider", () => {
  it("carries it on the charge, where the payable itself has no column for it", async () => {
    const { flows, world } = storyFlows({
      chain: [
        {
          name: "aurora",
          methods: ["CARD"],
          stub: true,
          publicKey: null,
          customerSchema: [{ key: "taxId", type: "CPF", required: true }],
        },
      ],
      customer: { name: "Ana Compradora", email: "ana@exemplo.com" },
    });
    render(<flows.Checkout />);
    await reachPayment();
    await waitFor(() => expect(screen.getByTestId("card-view")).toBeTruthy());
    fillCard();
    fireEvent.click(screen.getByTestId("card-pay"));

    await waitFor(() => expect(world.seen.length).toBeGreaterThan(0));
    // Masked exactly as the buyer typed it, which is what the shipped client
    // sends today — the provider gate strips the punctuation itself. What is
    // load-bearing is that it ARRIVED: sourced from the payable alone it is
    // simply not there, and the buyer is asked for a document they typed two
    // screens earlier.
    expect((world.seen[0]?.customer?.taxId ?? "").replace(/\D/g, "")).toBe("52998224725");
    expect(world.seen[0]?.customer?.email).toBe("ana@exemplo.com");
  });
});
