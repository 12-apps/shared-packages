// @vitest-environment jsdom
/**
 * FUT-3685 — the wallets as a block ABOVE the list ("PAGAMENTO RÁPIDO"), and
 * the card path's per-order key.
 *
 *  - A wallet shows only when the chain head declares it AND the device can
 *    pay AND the card is offered here (R5); none ready ⇒ no heading, no
 *    buttons, no divider (E4); one ⇒ its button alone (E5).
 *  - Pressing one opens its sheet INSIDE the press, priced at the amount due,
 *    raises the order in parallel, and never changes the chosen row (R1, C5,
 *    C6). The key is charged only when the order asks the provider for the
 *    amount the sheet showed (R4). Apple's session is created and begun
 *    synchronously in the tap — Safari's rule — and closed with the charge's
 *    honest outcome.
 *  - A store whose card key is minted per order is charged only once that key
 *    has arrived.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutDoorOption } from "../list/types";
import type { CheckoutProviderConfig, CreateOrderRequest, CreateOrderResult } from "../types";
import {
  SAVED_VISA,
  installApple,
  installGoogle,
  onPageStore,
  orderFor,
  renderList,
  stubClient,
  uninstallWallets,
  walletStore,
} from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const validate = () => vi.fn(async () => ({ merchantSession: "ok" }));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  vi.useRealTimers();
  cleanup();
});

const createOrder = () => vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));

function door(): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", hint: "Diga se precisa de troco", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
}

describe("the PAGAMENTO RÁPIDO block", () => {
  it("is not there at all when no wallet is ready: no heading, no buttons, no divider (E4)", async () => {
    // Declared, priced — but this browser has neither pay.js nor ApplePaySession.
    renderList({ config: walletStore(["GOOGLE_PAY", "APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Pagamento rápido")).toBeNull());
    await waitFor(() => expect(screen.queryByText("ou escolha como pagar")).toBeNull());
  });

  it("shows only Google's button when only Google Pay is ready, full width (E5)", async () => {
    installGoogle();
    renderList({ config: walletStore(["GOOGLE_PAY"]), client: stubClient(), list: { totalCents: 2700 } });
    const block = await screen.findByTestId("list-wallets");
    expect(within(block).getByText("Pagamento rápido")).toBeTruthy();
    expect(within(block).getByText("ou escolha como pagar")).toBeTruthy();
    expect(within(block).getByTestId("google-pay-native")).toBeTruthy();
    await waitFor(() => expect(within(block).queryByTestId("list-apple-pay")).toBeNull());
    // Google is no longer a row (FUT-3685).
    await waitFor(() => expect(screen.queryByTestId("list-option-GOOGLE_PAY")).toBeNull());
  });

  it("shows both, Google first, when both are ready", async () => {
    installGoogle();
    installApple();
    renderList({ config: walletStore(["GOOGLE_PAY", "APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    const buttons = await screen.findByTestId("list-wallet-buttons");
    await waitFor(() => expect(within(buttons).getByTestId("list-google-pay")).toBeTruthy());
    const apple = within(buttons).getByRole("button", { name: "Pagar com Apple Pay" });
    expect(within(buttons).getByTestId("list-google-pay").compareDocumentPosition(apple) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sits above the rows, under the CPF, and outside their radio group (R1)", async () => {
    installGoogle();
    renderList({ config: walletStore(), client: stubClient(), taxIdOnFile: false, list: { totalCents: 2700 } });
    const block = await screen.findByTestId("list-wallets");
    const cpf = screen.getByTestId("list-buyer-taxId");
    const pix = screen.getByTestId("list-option-PIX");
    expect(cpf.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(pix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).queryAllByRole("radio")).toHaveLength(0);
  });

  it("has no Apple Pay without the chain head declaring it, even on a device that can pay (R5)", async () => {
    installGoogle();
    installApple();
    renderList({ config: walletStore(["GOOGLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    await screen.findByTestId("google-pay-native");
    await waitFor(() => expect(screen.queryByTestId("list-apple-pay")).toBeNull());
  });

  it("has no Apple Pay on a device that cannot pay, nor without the host's merchant-validation port", async () => {
    installApple(false);
    const first = renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
    first.unmount();
    installApple(true);
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), list: { totalCents: 2700 } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("is not offered at a store that takes no card here — a Pix-only store", async () => {
    installGoogle();
    installApple();
    renderList({ config: walletStore(["GOOGLE_PAY", "APPLE_PAY"], { methods: ["PIX"] }), client: stubClient(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    await screen.findByTestId("list-option-PIX");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });

  it("is not offered when the host gives no price for the sheet, or a price of zero", async () => {
    installGoogle();
    const first = renderList({ config: walletStore(), client: stubClient() });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
    first.unmount();
    renderList({ config: walletStore(), client: stubClient(), list: { totalCents: 0 } });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-wallets")).toBeNull());
  });
});

describe("Google Pay's press", () => {
  it("opens the sheet INSIDE the press at the amount due, raises the order, charges its key — without changing the chosen row", async () => {
    const { loadPaymentData } = installGoogle();
    const client = stubClient([SAVED_VISA]);
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    const raise = createOrder();
    renderList({ config: walletStore(), client, createOrder: raise, list: { totalCents: 2700 } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    // Synchronously, in the press: the browser opens a sheet only inside the tap.
    expect(loadPaymentData).toHaveBeenCalledTimes(1);
    expect((loadPaymentData.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "27.00" } });
    expect(radio("list-option-CARD").checked).toBe(true);
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD" }));
    expect(client.chargeWallet).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-card", wallet: { type: "GOOGLE_PAY", key: "gpay-key" } }));
    expect(client.charge).not.toHaveBeenCalled();
    await screen.findByTestId("payment-status");
  });

  it("refuses to charge a key whose sheet showed another amount than the order asks for (R4)", async () => {
    installGoogle();
    const client = stubClient();
    renderList({ config: walletStore(), client, createOrder: createOrder(), list: { totalCents: 2500 } });
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await screen.findByText(/^Não foi possível concluir o pagamento com o Google Pay/);
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("sends nothing more when the buyer closes the sheet, and the block is back", async () => {
    installGoogle(async () => Promise.reject(Object.assign(new Error("closed"), { statusCode: "CANCELED" })));
    const client = stubClient();
    renderList({ config: walletStore(), client, createOrder: createOrder(), list: { totalCents: 2700 } });
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await waitFor(() => expect(screen.getByTestId("payment-list").getAttribute("data-locked")).toBe("false"));
    expect(screen.getByTestId("google-pay-native")).toBeTruthy();
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("is never held by a door choice (R3)", async () => {
    installGoogle();
    renderList({ config: walletStore(), client: stubClient(), list: { totalCents: 2700, door: [door()] } });
    await screen.findByTestId("google-pay-native");
    fireEvent.click(radio("list-door-cash"));
    expect(screen.getByTestId("list-wallet-buttons").getAttribute("aria-disabled")).toBeNull();
  });
});

describe("Apple Pay's press", () => {
  it("creates and begins the session synchronously inside the tap, priced at the amount due", async () => {
    const { sessions } = installApple();
    const client = stubClient();
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    const raise = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method, { amountDueCents: 2200 }) }));
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: raise, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" }, validateApplePayMerchant: validate() });
    const button = await screen.findByRole("button", { name: "Pagar com Apple Pay" });
    fireEvent.click(button);
    // No await between the click and these: Safari refuses a session begun outside the tap.
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.begun).toBe(true);
    expect(sessions[0]?.request.total.amount).toBe("22.00");
    await act(async () => sessions[0]?.onpaymentauthorized?.({ payment: { token: { paymentData: { data: "apple" } } } }));
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
    expect(client.chargeWallet).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-card", wallet: { type: "APPLE_PAY", key: JSON.stringify({ data: "apple" }) } }));
    await waitFor(() => expect(sessions[0]?.completed).toEqual([0]));
  });

  it("validates the merchant through the host's port", async () => {
    const { sessions } = installApple();
    const port = validate();
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), createOrder: createOrder(), list: { totalCents: 2700 }, validateApplePayMerchant: port });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    sessions[0]?.onvalidatemerchant?.({ validationURL: "https://apple-pay-gateway.apple.com/x" });
    await waitFor(() => expect(port).toHaveBeenCalledWith("https://apple-pay-gateway.apple.com/x"));
  });

  it("refuses a key whose sheet showed another amount than the order asks for, and fails the sheet (R4)", async () => {
    const { sessions } = installApple();
    const client = stubClient();
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: createOrder(), list: { totalCents: 2500 }, validateApplePayMerchant: validate() });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    await act(async () => sessions[0]?.onpaymentauthorized?.({ payment: { token: { paymentData: {} } } }));
    await waitFor(() => expect(sessions[0]?.completed).toEqual([1]));
    expect(client.chargeWallet).not.toHaveBeenCalled();
    await screen.findByText(/^Não foi possível iniciar o Apple Pay/);
  });

  it("fails the sheet when the provider refuses the charge", async () => {
    const { sessions } = installApple();
    const client = stubClient();
    client.chargeWallet.mockResolvedValue({ ok: false, error: "Cartão recusado.", code: "DECLINED" });
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: createOrder(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    await act(async () => sessions[0]?.onpaymentauthorized?.({ payment: { token: { paymentData: {} } } }));
    await waitFor(() => expect(sessions[0]?.completed).toEqual([1]));
    await screen.findByText("Cartão recusado.");
  });

  it("fails an authorized sheet whose order the host refused to raise, and charges nothing", async () => {
    const { sessions } = installApple();
    const client = stubClient();
    const refuse = vi.fn(async (): Promise<CreateOrderResult> => ({ ok: false, error: { code: "CLOSED", message: "A loja fechou.", field: null } }));
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: refuse, list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    await screen.findByText("A loja fechou.");
    await act(async () => sessions[0]?.onpaymentauthorized?.({ payment: { token: { paymentData: {} } } }));
    await waitFor(() => expect(sessions[0]?.completed).toEqual([1]));
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("sends nothing when the buyer closes the sheet", async () => {
    const { sessions } = installApple();
    const client = stubClient();
    renderList({ config: walletStore(["APPLE_PAY"]), client, createOrder: createOrder(), list: { totalCents: 2700 }, validateApplePayMerchant: validate() });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    await act(async () => sessions[0]?.oncancel?.());
    await waitFor(() => expect(screen.getByTestId("payment-list").getAttribute("data-locked")).toBe("false"));
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("says why when the merchant cannot be validated", async () => {
    const { sessions } = installApple();
    const failing = vi.fn(async () => Promise.reject(new Error("no merchant")));
    renderList({ config: walletStore(["APPLE_PAY"]), client: stubClient(), createOrder: createOrder(), list: { totalCents: 2700 }, validateApplePayMerchant: failing });
    fireEvent.click(await screen.findByRole("button", { name: "Pagar com Apple Pay" }));
    sessions[0]?.onvalidatemerchant?.({ validationURL: "https://apple.example/v" });
    await screen.findByText(/^Não foi possível iniciar o Apple Pay/);
    expect(sessions[0]?.aborted).toBe(true);
  });
});

describe("a card key minted per order", () => {
  it("charges only once the order's key has arrived", async () => {
    const base = onPageStore();
    const head = base.chain?.[0];
    if (!head) throw new Error("the store has a chain head");
    const pagbank: CheckoutProviderConfig = { ...base, provider: "pagbank", mockTokenization: false, chain: [{ ...head, provider: "pagbank", mockTokenization: false }] };
    const client = stubClient([SAVED_VISA]);
    const answers: ((value: { ok: true; data: { publicKey: string } }) => void)[] = [];
    const keyAnswer = new Promise<{ ok: true; data: { publicKey: string } }>((resolve) => answers.push(resolve));
    client.refreshBrowserKey.mockReturnValue(keyAnswer);
    renderList({ config: pagbank, client, createOrder: createOrder() });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.refreshBrowserKey).toHaveBeenCalledWith({ orderId: "o-card" }));
    expect(client.charge).not.toHaveBeenCalled();
    await act(async () => answers[0]?.({ ok: true, data: { publicKey: "pk_order" } }));
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
  });
});
