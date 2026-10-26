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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARGE_WINDOW_MS } from "../../components/checkout/list/use-list-charge";
import type { CheckoutComponents } from "../../components/checkout/ui";
import { storyFlows } from "../../stories/host";

afterEach(cleanup);
// A raised order is parked in `sessionStorage` now (FUT-1140), and these suites
// share one jsdom tab — so without this, one test's checkout resumes the
// previous test's payment.
beforeEach(() => window.sessionStorage.clear());

/** A CPF that passes the check digits, so the list lets the buyer pay. */
const GOOD_CPF = "529.982.247-25";

/**
 * Land on Pagamento — the one list (FUT-4028) — and type the CPF at its top
 * when the store asks for one, the way a buyer does.
 */
async function reachPayment(): Promise<void> {
  await screen.findByTestId("payment-list");
  await waitFor(() => expect(screen.queryByTestId("list-top-loading")).toBeNull());
  const cpf = screen.queryByTestId("list-buyer-taxId");
  if (cpf) fireEvent.change(cpf, { target: { value: GOOD_CPF } });
}

/** Choose the card row and wait for its form. */
async function chooseCard(): Promise<void> {
  fireEvent.click(screen.getByTestId("list-option-CARD-radio"));
  await waitFor(() => expect(screen.getByTestId("card-number")).toBeTruthy());
}

/** Press the bar, and let its five-second window run out so the charge leaves. */
async function payNow(): Promise<void> {
  vi.useFakeTimers();
  fireEvent.click(screen.getByTestId("list-pay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
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
    await screen.findByTestId("payment-list");
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
    await waitFor(() => expect(screen.getByTestId("list-pay")).toBeTruthy());
    expect(screen.getByTestId("list-pay").getAttribute("data-host-slot")).toBe("button");
  });

  it("reaches a standalone screen from the SAME factory", async () => {
    // Stated separately because the two paths disagreed: `screens.*` stop at
    // `FlowsShell` and always kept the host's slots. One surface, one answer.
    const { flows } = storyFlows({}, { components: hostComponents });
    render(<flows.screens.EmptyCart />);
    await waitFor(() => expect(screen.getByTestId("checkout-empty-back")).toBeTruthy());
    expect(screen.getByTestId("checkout-empty-back").getAttribute("data-host-slot")).toBe("button");
  });

  it("still renders the raw-MUI defaults when the host filled nothing", async () => {
    const { flows } = storyFlows();
    render(<flows.Checkout />);
    await waitFor(() => expect(screen.getByTestId("list-pay")).toBeTruthy());
    expect(screen.getByTestId("list-pay").getAttribute("data-host-slot")).toBeNull();
  });
});

describe("a store that cannot charge", () => {
  it("renders the unavailable screen and never a payment list", async () => {
    const { flows } = storyFlows({ chain: [] });
    render(<flows.Checkout />);
    await waitFor(() =>
      expect(screen.getByTestId("checkout-payments-disabled")).toBeTruthy(),
    );
    await waitFor(() => expect(screen.queryByTestId("payment-list")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-buyer-taxId")).toBeNull());
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
    await waitFor(() => expect(screen.queryByTestId("payment-list")).toBeNull());
  });
});

describe("the methods a chain declares", () => {
  it("offers PIX only, preselects it, and renders the QR off the payload", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", methods: ["PIX"], stub: true, publicKey: null }],
    });
    render(<flows.Checkout />);
    await reachPayment();

    await waitFor(() => expect(screen.queryByTestId("list-option-CARD")).toBeNull());
    // The sole method is taken rather than demanded (FUT-3942) — and the code
    // that follows the bar's one tap comes from the payload the real mount
    // raised, not from a fixture.
    expect((screen.getByTestId("list-option-PIX-radio") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(screen.getByTestId("list-pix")).toBeTruthy());
    expect(screen.getByTestId("list-pix-code").textContent).toContain("BR.GOV.BCB.PIX");
  });

  it("offers both when the chain declares both", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", methods: ["PIX", "CARD"], stub: true, publicKey: null }],
    });
    render(<flows.Checkout />);
    await reachPayment();
    expect(screen.getByTestId("list-option-PIX")).toBeTruthy();
    expect(screen.getByTestId("list-option-CARD")).toBeTruthy();
  });
});

describe("what the list asks the buyer for (FUT-595)", () => {
  it("asks for the CPF at the top, and holds the bar, when the chain declares it", async () => {
    const { flows } = storyFlows({ chain: [{ name: "aurora", stub: true, publicKey: null }] });
    render(<flows.Checkout />);
    await screen.findByTestId("list-buyer-taxId");
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(screen.getByTestId("list-blocked-reason")).toBeTruthy());
  });

  it("asks for the PHONE when that is what the chain declares, and no CPF", async () => {
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
    await reachPayment();
    // No CPF is demanded — this chain never asked for one.
    await waitFor(() => expect(screen.queryByTestId("list-buyer-taxId")).toBeNull());
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    await waitFor(() => expect(screen.getByTestId("list-buyer-phone")).toBeTruthy());
  });

  it("asks nothing REQUIRED when the chain declares an empty schema", async () => {
    const { flows } = storyFlows({
      chain: [{ name: "aurora", stub: true, publicKey: null, customerSchema: [] }],
    });
    render(<flows.Checkout />);
    await reachPayment();
    await waitFor(() => expect(screen.queryByTestId("list-buyer-taxId")).toBeNull());
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(screen.getByTestId("list-pix")).toBeTruthy());
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
    await chooseCard();
    fillCard();
    await payNow();

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
    await chooseCard();
    fillCard();
    await payNow();

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
    await chooseCard();
    fillCard();
    await payNow();

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

describe("the confirmation the host composes at the factory (FUT-3685)", () => {
  it("reaches the paid screen: the footer after its actions, and the emphasis of the way out", async () => {
    const { flows } = storyFlows(
      { chain: [{ name: "aurora", methods: ["CARD"], stub: true, publicKey: null }] },
      { confirmationFooter: <p data-testid="host-footer">Volte sempre</p>, backActionEmphasis: "primary" },
    );
    render(<flows.Checkout />);
    await reachPayment();
    await chooseCard();
    fillCard();
    await payNow();
    await waitFor(() => expect(screen.getByTestId("payment-paid")).toBeTruthy());
    expect(screen.getByTestId("host-footer").textContent).toBe("Volte sempre");
  });
});
