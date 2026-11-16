// @vitest-environment jsdom
/**
 * FUT-612 — a short capture tells the buyer what is missing and lets them pay
 * only the difference (option C).
 *
 * Before: a payable parked short answered `"FAILED"`, the same token a declined
 * card answers, and the screen said "Nenhum valor foi cobrado" to somebody
 * whose money had arrived. These pin the package's half: the screen renders a
 * money fact ONLY when the server states one, a decline keeps today's screen
 * byte for byte, and the transport reads the fact without changing `getStatus`.
 */
import { describe, expect, it, vi } from "vitest";

import type { PaymentShortfall } from "@12-apps/payments-backend";

import { EN_US_PAYMENT_STATUS_COPY } from "../en-US";
import { PaymentStatus } from "../payment-status";
import { PT_BR_PAYMENT_STATUS_COPY, PT_BR_SHORT_PAYMENT_COPY } from "../pt-BR";
import { createCheckoutClient } from "../transport";
import { fireEvent, render, screen } from "./test-utils";

const SHORT: PaymentShortfall = { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null };

/** Every test id on the page — absence is read from this list, never from a null query. */
const testIds = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-testid]")].map((element) => element.dataset.testid ?? "");

/** NBSP from `Intl` read as the space a person sees. */
const text = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ");

function renderStatus(props: Partial<Parameters<typeof PaymentStatus>[0]> = {}) {
  return render(
    <PaymentStatus
      copy={PT_BR_PAYMENT_STATUS_COPY}
      status="FAILED"
      totalLabel="R$ 20,70"
      onBackToMenu={() => undefined}
      onRetry={() => undefined}
      {...props}
    />,
  );
}

describe("a real decline keeps today's screen, byte for byte", () => {
  it("says nothing was charged and offers the retry when the server states no fact", () => {
    const { container } = renderStatus();
    expect(screen.getByTestId("payment-failed")).toBeTruthy();
    const facts = container.querySelectorAll("[data-money-fact]");
    expect(text()).toContain("Pagamento não concluído");
    expect(text()).toContain("Nenhum valor foi cobrado. Você pode tentar novamente.");
    expect(screen.getByTestId("payment-retry")).toBeTruthy();
    expect(facts).toHaveLength(0);
  });

  it("renders the same markup with a null fact as with none", () => {
    const first = renderStatus();
    const bare = first.container.innerHTML;
    first.unmount();
    const withNull = renderStatus({ shortfall: null, stockGone: null }).container.innerHTML;
    expect(withNull).toBe(bare);
  });

  it("keeps the decline screen for a host whose pack has no short words", () => {
    renderStatus({ copy: { ...PT_BR_PAYMENT_STATUS_COPY, short: undefined }, shortfall: SHORT });
    expect(screen.getByTestId("payment-failed")).toBeTruthy();
  });
});

describe("the SHORT outcome (option C)", () => {
  it("says what is missing, shows the receipt and both acts, and never says nothing was charged", () => {
    renderStatus({ shortfall: SHORT, onPayDifference: () => undefined, onRequestRefund: () => undefined });
    const page = text();
    expect(page).toContain("Faltam R$ 13,80 para fechar o pedido");
    expect(page).toContain(
      "Recebemos R$ 6,90 dos R$ 20,70 do pedido. Pague só a diferença para confirmar, ou cancele e receba o valor de volta.",
    );
    expect(page).toContain("Total do pedido");
    expect(page).toContain("Já pago (Pix)");
    expect(page).toContain("Falta pagar");
    expect(screen.getByTestId("payment-short-due").textContent?.replace(/\s/g, " ")).toBe("R$ 13,80");
    expect(screen.getByTestId("payment-short-pay").textContent?.replace(/\s/g, " ")).toBe("Pagar R$ 13,80");
    expect(screen.getByTestId("payment-short-refund").textContent?.replace(/\s/g, " ")).toBe(
      "Cancelar e receber R$ 6,90 de volta",
    );
    expect(page).not.toContain("Nenhum valor foi cobrado");
    expect(testIds()).not.toContain("payment-retry");
  });

  it("hands each act to the host", () => {
    const pay = vi.fn();
    const refund = vi.fn();
    renderStatus({ shortfall: SHORT, onPayDifference: pay, onRequestRefund: refund });
    fireEvent.click(screen.getByTestId("payment-short-pay"));
    fireEvent.click(screen.getByTestId("payment-short-refund"));
    expect(pay).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("offers no act the host did not bind", () => {
    renderStatus({ shortfall: SHORT });
    expect(testIds()).not.toContain("payment-short-pay");
    expect(testIds()).not.toContain("payment-short-refund");
  });

  it("stands both acts down while one runs", () => {
    renderStatus({ shortfall: SHORT, onPayDifference: () => undefined, onRequestRefund: () => undefined, shortBusy: "refund" });
    expect((screen.getByTestId("payment-short-pay") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("payment-short-refund") as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the card when the capture was a card", () => {
    renderStatus({ shortfall: { ...SHORT, paidMethod: "CARD" } });
    expect(text()).toContain("Já pago (Cartão)");
  });

  it.each([
    ["REVIEWING", { dueCents: 0 }, "payment-short-reviewing", "A loja está conferindo o seu pagamento"],
    ["REFUNDED", { resolution: "REFUNDED" as const }, "payment-short-refunded", "Devolvemos R$ 6,90"],
    ["REFUND_PENDING", { resolution: "REFUND_PENDING" as const }, "payment-short-refund-pending", "A devolução de R$ 6,90 está em andamento"],
  ])("the %s face offers neither pay nor refund", (_face, over, testId, heading) => {
    renderStatus({ shortfall: { ...SHORT, ...over }, onPayDifference: () => undefined, onRequestRefund: () => undefined });
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(text()).toContain(heading);
    expect(testIds()).not.toContain("payment-short-pay");
    expect(testIds()).not.toContain("payment-short-refund");
  });

  it("reads confirmed when the store settled it, even on a PAID token", () => {
    renderStatus({ status: "PAID", shortfall: { ...SHORT, resolution: "SETTLED" } });
    expect(screen.getByTestId("payment-short-settled")).toBeTruthy();
    expect(text()).toContain("A loja recebeu o valor que faltava e confirmou o pedido.");
  });

  it("keeps the paid receipt on a PAID token whose short is not the store's settlement", () => {
    renderStatus({ status: "PAID", shortfall: SHORT });
    expect(screen.getByTestId("payment-paid")).toBeTruthy();
  });

  it("never shows a fact while the wait has no answer", () => {
    renderStatus({ status: "AWAITING_PAYMENT", shortfall: SHORT });
    expect(testIds()).not.toContain("payment-short");
  });

  it("speaks the en-US pack", () => {
    renderStatus({ copy: EN_US_PAYMENT_STATUS_COPY, shortfall: SHORT, onPayDifference: () => undefined });
    expect(text()).toContain("$13.80 still to pay to complete the order");
    expect(text()).toContain("Pay $13.80");
  });
});

describe("the stock-gone notice (decision 3)", () => {
  it("says what arrived and what ran out, with no action at all", () => {
    renderStatus({
      stockGone: { receivedCents: 2070, missing: ["Pão de queijo", "Café"] },
      shortfall: SHORT,
      onPayDifference: () => undefined,
      onRequestRefund: () => undefined,
    });
    // Two names: the verb agrees, the names are the host's own, and the heading has no period.
    expect(screen.getByRole("heading").textContent?.replace(/\s/g, " ")).toBe("Recebemos R$ 20,70, mas acabaram Pão de queijo e Café");
    expect(text()).toContain("A loja vai confirmar ou devolver; você recebe um aviso.");
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(text()).not.toContain("Nenhum valor foi cobrado");
  });
});

describe("the stock-gone notice's words (B6, U3)", () => {
  const heading = (): string => (screen.getByRole("heading").textContent ?? "").replace(/\s/g, " ");

  it("one item: 'acabou', the name exactly as the host sent it", () => {
    renderStatus({ stockGone: { receivedCents: 2070, missing: ["Pão de Queijo"] } });
    expect(heading()).toBe("Recebemos R$ 20,70, mas acabou Pão de Queijo");
  });

  it.each([
    ["no name at all", []],
    ["only blank names", ["", "  "]],
  ])("%s: its own sentence, never a dangling 'acabou .'", (_what, missing) => {
    renderStatus({ stockGone: { receivedCents: 2070, missing } });
    expect(heading()).toBe("Recebemos R$ 20,70, mas um item do pedido acabou");
    expect(text()).toContain("A loja vai confirmar ou devolver; você recebe um aviso.");
  });

  it("en-US has the same unnamed sentence", () => {
    renderStatus({ copy: EN_US_PAYMENT_STATUS_COPY, stockGone: { receivedCents: 2070, missing: [] } });
    expect(heading()).toBe("We received $20.70, but an item of the order has run out");
  });
});

describe("the short screen's look (U1, U2)", () => {
  it("puts the two acts in one wrapping row and the glyph in a tinted chip", () => {
    renderStatus({ shortfall: SHORT, onPayDifference: () => undefined, onRequestRefund: () => undefined });
    const row = screen.getByTestId("payment-short-actions");
    expect(row.querySelectorAll("button")).toHaveLength(2);
    expect(getComputedStyle(row).flexWrap).toBe("wrap");
    expect(screen.getByTestId("payment-short-chip").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading").tagName).toBe("H2");
  });
});

describe("getStatusDetail", () => {
  const client = (body: unknown, status = 200) =>
    createCheckoutClient({
      copy: { failed: "failed", offline: "offline", invalidResponse: "invalid" },
      fetchImpl: async () => Response.json(body, { status }),
    });

  it("reads the shortfall beside the token", async () => {
    expect(await client({ data: "FAILED", shortfall: SHORT }).getStatusDetail!("o1")).toEqual({
      ok: true,
      data: { status: "FAILED", shortfall: SHORT },
    });
  });

  it("reads the stock-gone fact", async () => {
    const result = await client({ data: "FAILED", stockGone: { receivedCents: 2070, missing: ["X"] } }).getStatusDetail!("o1");
    expect(result).toEqual({ ok: true, data: { status: "FAILED", stockGone: { receivedCents: 2070, missing: ["X"] } } });
  });

  it("answers the bare status for a decline, and for a fact it cannot read", async () => {
    expect(await client({ data: "FAILED" }).getStatusDetail!("o1")).toEqual({ ok: true, data: { status: "FAILED" } });
    expect(await client({ data: "FAILED", shortfall: { totalCents: "x" } }).getStatusDetail!("o1")).toEqual({
      ok: true,
      data: { status: "FAILED" },
    });
  });

  it("leaves getStatus answering the bare token", async () => {
    expect(await client({ data: "FAILED", shortfall: SHORT }).getStatus("o1")).toEqual({ ok: true, data: "FAILED" });
  });

  it("keeps a refusal a refusal", async () => {
    expect(await client({ error: "nope", code: "PAYABLE_NOT_FOUND" }, 404).getStatusDetail!("o1")).toEqual({
      ok: false,
      error: "nope",
      code: "PAYABLE_NOT_FOUND",
    });
  });
});

describe("the pt-BR short pack", () => {
  it("writes money as the store's buyers read it", () => {
    expect(PT_BR_SHORT_PAYMENT_COPY.money(1380).replace(/\s/g, " ")).toBe("R$ 13,80");
  });
});
