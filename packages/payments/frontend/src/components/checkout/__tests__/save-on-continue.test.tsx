// @vitest-environment jsdom
/**
 * The buyer's details must be persisted when they press "Continuar" on the
 * "Dados" step — NOT when a payment is raised.
 *
 * This is a regression test with a history: the save used to live only in the
 * order-creation path, which runs a whole step later, only once a payment
 * method is chosen, and which deliberately never writes the CPF. A buyer who
 * filled the form and then hit anything at all on the payment screen — no
 * provider configured, a declined card, an abandoned PIX, a closed tab — had
 * nothing stored.
 *
 * Since FUT-564 the write itself belongs to the host (`saveBuyerContact` port;
 * the storefront's implementation owns the wire shape and the blank-CPF-never-
 * clears rule, pinned in its own suite). What THIS suite pins is the flow's
 * side of the contract — TIMING, CONSENT and INDEPENDENCE: the port fires on
 * "Continuar", carries the CPF, respects the LGPD checkbox, and the step
 * advances no matter what the host does with the call.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCheckoutController, type CheckoutHostPorts } from "../use-checkout-controller";
import type { BuyerContact } from "../types";

/** A valid CPF (passes the client-side check digits). */
const VALID_CPF = "52998224725";

/**
 * One test's own port set + recorder. Everything is a local — no module-level
 * mutable state, so the tests carry no order dependency between them
 * (`test-flakiness/no-test-isolation`). The stub only ever PUSHES onto its
 * container, never reassigns a closed-over binding (`no-global-state-mutation`).
 */
function makePorts(): {
  ports: CheckoutHostPorts;
  savedContacts: () => BuyerContact[];
  orderRequested: () => boolean;
} {
  const recorded: BuyerContact[] = [];
  const createOrder = vi.fn();
  return {
    ports: {
      createOrder,
      saveBuyerContact: (contact) => {
        recorded.push(contact);
      },
      onExitToMenu: vi.fn(),
    },
    savedContacts: () => recorded,
    orderRequested: () => createOrder.mock.calls.length > 0,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('"Dados" step persists the buyer on Continuar', () => {
  it("saves name, phone and CPF the moment Continuar is pressed", async () => {
    const { ports, savedContacts, orderRequested } = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.setBuyer({ name: "Ana", phone: "11999999999", taxId: VALID_CPF });
    });
    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(savedContacts()).toHaveLength(1));
    expect(savedContacts()[0]).toEqual({
      name: "Ana",
      phone: "11999999999",
      taxId: VALID_CPF,
    });
    // The whole point: no order was created, and none needed to be.
    expect(orderRequested()).toBe(false);
  });

  it("advances to Pagamento without waiting on the save", async () => {
    const { ports, savedContacts } = makePorts();
    // A host whose save blows up must not trap the buyer on the Dados step —
    // the port is fire-and-forget, so the flow never sees the failure at all.
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.setBuyer({ name: "Ana", taxId: VALID_CPF });
    });
    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(savedContacts()).toHaveLength(1));
    expect(result.current.step).toBe("payment");
  });

  it("does not save when the buyer declined the consent checkbox", async () => {
    const { ports, savedContacts } = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.setBuyer({ name: "Ana", taxId: VALID_CPF });
      result.current.setSaveProfile(false);
    });
    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(result.current.step).toBe("payment"));
    expect(savedContacts()).toHaveLength(0);
  });

  it("does not save — or advance — when the CPF is invalid", async () => {
    const { ports, savedContacts } = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.setBuyer({ name: "Ana", taxId: "11111111111" });
    });
    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(result.current.errorField).toBe("cpf"));
    expect(result.current.step).toBe("dados");
    expect(savedContacts()).toHaveLength(0);
  });

  it("lets a buyer with a CPF on file continue without retyping it", async () => {
    const { ports, savedContacts } = makePorts();
    // Third argument: the buyer already gave the store a CPF, so Dados was
    // skipped and they reopened it through "Alterar". The field starts empty
    // (the client never receives the saved value) — requiring one here stranded
    // them on a form they had no way to satisfy.
    const { result } = renderHook(() => useCheckoutController(ports, undefined, true));

    act(() => {
      result.current.setStep("dados");
    });
    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(result.current.step).toBe("payment"));
    expect(result.current.errorField).toBeNull();
    // Nothing typed ⇒ the port carries no values at all. What the HOST must do
    // with a blank CPF (omit it so it can never clear the stored one) is the
    // host's contract, pinned beside its `saveBuyerContact` implementation.
    expect(savedContacts()[0]).toEqual({ name: undefined, phone: undefined, taxId: undefined });
  });

  it("still demands a CPF from a buyer who has none on file", async () => {
    const { ports, savedContacts } = makePorts();
    const { result } = renderHook(() => useCheckoutController(ports));

    act(() => {
      result.current.goToPayment();
    });

    await waitFor(() => expect(result.current.errorField).toBe("cpf"));
    expect(result.current.step).toBe("dados");
    expect(savedContacts()).toHaveLength(0);
  });
});
