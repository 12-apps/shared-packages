// @vitest-environment jsdom
/**
 * FUT-1170 — "Gerar novo código" must land the buyer on a code that is alive.
 *
 * The regenerate action set the step and raised a new charge WITHOUT dropping
 * the one it was replacing. So the payment step remounted on the expired order,
 * polled it, and got the terminal `EXPIRED` back — which bounced the flow to the
 * status step. The new order then arrived underneath that screen, and the status
 * step has no poller of its own, so the buyer sat under "Confirmando seu
 * pagamento" with a spinner, a live PIX code they were never shown, and nothing
 * on screen leading anywhere but "Voltar ao cardápio".
 *
 * ## Why the create is HELD in every test here
 *
 * With no latency the race resolves the other way and the flow recovers, which
 * is what made this look intermittent. The reproduction ran against PGlite,
 * which has ONE connection: the status read queued behind the create and
 * answered 11 ms after it, so the new order unmounted the old view before the
 * expired answer landed. That is a property of the harness. Against a real PIX
 * raise — a provider round trip — the bounce is the ordinary path.
 *
 * So the create is held here on purpose. A test that only passes because the
 * create was fast is the defect, not the proof of its absence.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JSX, ReactNode } from "react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import { PixView } from "../pix-view";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutOrder, CreateOrderResult, OrderStatus } from "../types";
import { useCheckoutController } from "../use-checkout-controller";
import { usePaymentPolling } from "../use-payment-polling";
import type { Result } from "../../../result";

/**
 * A fixed instant for the whole file. Every charge expiry below is stated
 * against it rather than against the wall clock, so what these tests exercise
 * is the same span on every run.
 */
const NOW = new Date("2026-09-05T12:00:00.000Z").getTime();

const AWAITING: Result<OrderStatus> = { ok: true, data: "AWAITING_PAYMENT" };
const EXPIRED: Result<OrderStatus> = { ok: true, data: "EXPIRED" };

/** How long a PIX charge in these tests has left to live. */
const CHARGE_LIFETIME_MS = 30 * 60_000;

/**
 * A checkout server for one store: it raises PIX orders on demand and answers
 * each one's status from a table the test writes.
 *
 * The counters live on one object rather than in closed-over `let`s — the
 * flakiness lane reads a binding reassigned from inside a stub as shared state,
 * and it is right to.
 */
function pixWorld(): {
  client: CheckoutClient;
  createOrder: (input: unknown) => Promise<CreateOrderResult>;
  /** How many times this order's status has been asked for. */
  asked: (orderId: string) => number;
  answerWith: (orderId: string, answer: Result<OrderStatus>) => void;
  /** Make the NEXT create wait until {@link releaseCreate}. */
  holdNextCreate: () => void;
  releaseCreate: () => void;
} {
  const world = {
    raised: 0,
    answers: new Map<string, Result<OrderStatus>>(),
    asked: new Map<string, number>(),
    hold: false,
    release: undefined as (() => void) | undefined,
  };

  const createOrder = async (): Promise<CreateOrderResult> => {
    if (world.hold) {
      world.hold = false;
      await new Promise<void>((resolve) => {
        world.release = resolve;
      });
    }
    world.raised += 1;
    const orderId = `o${world.raised}`;
    world.answers.set(orderId, AWAITING);
    const order: CheckoutOrder = {
      orderId,
      status: "AWAITING_PAYMENT",
      method: "PIX",
      totalCents: 2400,
      subtotalCents: 2400,
      discountTotalCents: 0,
      appliedDiscounts: [],
      totalLabel: "R$ 24,00",
      pix: {
        copyPaste: `00020126BR.GOV.BCB.PIX.${orderId}`,
        expiresAt: new Date(NOW + CHARGE_LIFETIME_MS).toISOString(),
      },
    };
    return { ok: true, data: order };
  };

  const client = {
    getStatus: async (ref: string) => {
      world.asked.set(ref, (world.asked.get(ref) ?? 0) + 1);
      return world.answers.get(ref) ?? AWAITING;
    },
  } as unknown as CheckoutClient;

  return {
    client,
    createOrder,
    asked: (orderId) => world.asked.get(orderId) ?? 0,
    answerWith: (orderId, answer) => world.answers.set(orderId, answer),
    holdNextCreate: () => {
      world.hold = true;
    },
    releaseCreate: () => world.release?.(),
  };
}

function withClient(client: CheckoutClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <CheckoutClientProvider client={client}>{children}</CheckoutClientProvider>;
  };
}

/** Let every scheduled poll, timer and pending promise settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Open the checkout on Pagamento (a buyer with a CPF on file) and choose PIX.
 * Returns once the first charge has been raised and its code is on screen.
 */
async function openOnPix(server: ReturnType<typeof pixWorld>): Promise<void> {
  render(
    <CheckoutFlow
      copy={PT_BR_CHECKOUT_VIEW_COPY}
      cart={{ empty: false, totalLabel: "R$ 24,00", totalItems: 1 }}
      createOrder={server.createOrder}
      onExitToMenu={vi.fn()}
      taxIdOnFile
    />,
    { wrapper: withClient(server.client) },
  );

  fireEvent.click(screen.getByTestId("checkout-method-PIX"));
  await elapse(0);
}

describe("regenerating an expired PIX code", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // A raised order is parked in `sessionStorage` (FUT-1140) and these suites
    // share one jsdom tab, so without this one test resumes another's payment.
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the new code, and polls it, when the raise takes a round trip", async () => {
    const server = pixWorld();
    await openOnPix(server);
    expect(screen.getByTestId("pix-view")).toBeTruthy();

    // The charge expires server-side; the wait brings the terminal answer back
    // and the flow lands on the confirmation screen with its regenerate action.
    server.answerWith("o1", EXPIRED);
    await elapse(3_000);
    expect(screen.getByTestId("payment-expired")).toBeTruthy();

    // "Gerar novo código", with the raise held the way a provider holds it.
    server.holdNextCreate();
    fireEvent.click(screen.getByTestId("payment-regenerate"));
    await elapse(3_000);
    server.releaseCreate();
    await elapse(3_000);

    // The buyer is looking at the new code…
    expect(screen.getByTestId("pix-view")).toBeTruthy();
    // …and something is actually watching it settle. Zero polls here is the
    // ticket: a live charge nobody is asking about, under a spinner.
    expect(server.asked("o2")).toBeGreaterThan(0);
  });

  it("stops asking about the charge it just replaced", async () => {
    const server = pixWorld();
    await openOnPix(server);

    server.answerWith("o1", EXPIRED);
    await elapse(3_000);
    const beforeRegenerate = server.asked("o1");

    // The moment the ticket measures at +114 ms: the step re-renders on the
    // order being REPLACED and asks about it. That ask is what answers EXPIRED
    // again and throws the flow back to the confirmation screen.
    server.holdNextCreate();
    fireEvent.click(screen.getByTestId("payment-regenerate"));
    await elapse(3_000);
    expect(server.asked("o1")).toBe(beforeRegenerate);

    server.releaseCreate();
    await elapse(30_000);

    // And it stays stopped. The expired order is not this checkout's business
    // any more, and every ask about it is a provider round trip.
    expect(server.asked("o1")).toBe(beforeRegenerate);
  });
});

/** A PIX order whose code has `ms` left before it expires. */
function chargeExpiringIn(ms: number): CheckoutOrder {
  return {
    orderId: "o-pix",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents: 2400,
    subtotalCents: 2400,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 24,00",
    pix: {
      copyPaste: "00020126BR.GOV.BCB.PIX",
      expiresAt: new Date(NOW + ms).toISOString(),
    },
  };
}

/** A server that never settles anything — the abandoned checkout. */
function patientClient(): { client: CheckoutClient; asked: () => number } {
  const tally = { asked: 0 };
  const client = {
    getStatus: async () => {
      tally.asked += 1;
      return AWAITING;
    },
  } as unknown as CheckoutClient;
  return { client, asked: () => tally.asked };
}

describe("the wait knows WHICH order it is waiting on", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never reports one order's answer as the next one's", async () => {
    // The guard the regenerate path needs, stated where every consumer gets it.
    // A view re-pointed at a NEW charge must not read the previous charge's
    // terminal status off a hook that has not answered yet — that reading is
    // what hands a fresh, unpaid order straight to the confirmation screen.
    const client = {
      getStatus: async (ref: string) => (ref === "o1" ? EXPIRED : AWAITING),
    } as unknown as CheckoutClient;
    const { result, rerender } = renderHook(({ id }) => usePaymentPolling(id, {}), {
      initialProps: { id: "o1" },
      wrapper: withClient(client),
    });

    await elapse(0);
    expect(result.current.status).toBe("EXPIRED");

    rerender({ id: "o2" });

    expect(result.current.status).toBeNull();
  });
});

describe("how long a PIX code is waited on", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops once the code itself is dead, and says so rather than pulsing", async () => {
    const { client, asked } = patientClient();
    render(<PixView order={chargeExpiringIn(60_000)} onResolved={vi.fn()} />, {
      wrapper: withClient(client),
    });
    await elapse(0);
    expect(screen.getByTestId("pix-awaiting")).toBeTruthy();

    // Well past the code's own expiry, and past any grace for the server's
    // EXPIRED to arrive.
    await elapse(10 * 60_000);
    expect(screen.getByTestId("pix-poll-timeout")).toBeTruthy();

    const stopped = asked();
    await elapse(30 * 60_000);
    expect(asked()).toBe(stopped);
  });

  it("gives the buyer the wait back when they ask for it", async () => {
    const { client, asked } = patientClient();
    render(<PixView order={chargeExpiringIn(60_000)} onResolved={vi.fn()} />, {
      wrapper: withClient(client),
    });
    await elapse(10 * 60_000);
    const stopped = asked();

    fireEvent.click(screen.getByTestId("pix-check-again"));
    await elapse(0);

    expect(asked()).toBe(stopped + 1);
  });

  it("decays instead of asking every 2.5s for the life of the code", async () => {
    // Every poll is a provider round trip. A thirty-minute code left open on a
    // phone was 720 of them, at one cadence, for a buyer who in the common case
    // pays in the first thirty seconds.
    const { client, asked } = patientClient();
    render(<PixView order={chargeExpiringIn(30 * 60_000)} onResolved={vi.fn()} />, {
      wrapper: withClient(client),
    });

    await elapse(10 * 60_000);

    expect(asked()).toBeLessThan(60);
    // …and it is still asking. A cadence that decays to nothing is the same
    // silent stop wearing a slower fuse.
    expect(asked()).toBeGreaterThan(10);
  });
});

describe("the confirmation screen's own wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("watches the order it is holding, however the flow got there", async () => {
    // The generalisation of the ticket. Dropping the replaced charge closes the
    // one door FUT-1170 came through; this closes the shape — a flow parked on
    // Confirmação with a live order and a spinner that stands for nothing.
    const server = pixWorld();
    const { result } = renderHook(
      () => useCheckoutController({ createOrder: server.createOrder, onExitToMenu: vi.fn() }),
      { wrapper: withClient(server.client) },
    );

    await act(async () => {
      await result.current.startPayment("PIX");
    });
    act(() => result.current.setStep("status"));
    await elapse(3_000);

    expect(server.asked("o1")).toBeGreaterThan(0);

    server.answerWith("o1", { ok: true, data: "PAID" });
    await elapse(3_000);

    expect(result.current.finalStatus).toBe("PAID");
  });

  it("says so when its clock runs out, rather than spinning on", async () => {
    const server = pixWorld();
    const { result } = renderHook(
      () => useCheckoutController({ createOrder: server.createOrder, onExitToMenu: vi.fn() }),
      { wrapper: withClient(server.client) },
    );

    await act(async () => {
      await result.current.startPayment("PIX");
    });
    act(() => result.current.setStep("status"));
    await elapse(5 * 60_000);

    // Which is what puts "Verificar de novo" on the screen: `PaymentStatus`
    // offers the ask only where the spinner would otherwise be a lie.
    expect(result.current.awaitingTimedOut).toBe(true);
  });
});
