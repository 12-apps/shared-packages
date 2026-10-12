// @vitest-environment jsdom
/**
 * FUT-3525 — the Pagamento step as the approved prototype: the order summary
 * beside the payment on a computer (layout A), the total, chips and a sticky
 * pay bar on a phone (layout C), and the method choice as tabs on both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentProps, type JSX } from "react";

import { PaymentStep } from "../checkout-steps";
import { MethodTabs } from "../method-tabs";
import {
  CheckoutLayoutProvider,
  StickyPayBar,
  PayBarTotalProvider,
  useWideLayout,
  WIDE_CHECKOUT_MIN,
} from "../payment-step-layout";
import { PT_BR_CHECKOUT_SCREENS_COPY } from "../screens-pt-BR";
import { cleanup, fireEvent, render, screen } from "./test-utils";

afterEach(cleanup);

const layout = PT_BR_CHECKOUT_SCREENS_COPY.layout;

type StepProps = ComponentProps<typeof PaymentStep>;

function step(overrides: Partial<StepProps> = {}): StepProps {
  return {
    method: null,
    onMethodChange: vi.fn(),
    order: null,
    buyer: { name: "Ana Compradora" },
    creating: false,
    createError: null,
    errorField: null,
    onGenerate: vi.fn(),
    onUseEmail: vi.fn(),
    providerConfig: null,
    cartTotals: { totalLabel: "R$ 42,90", totalItems: 2 },
    onResolved: vi.fn(),
    ...overrides,
  };
}

function renderStep(wide: boolean, overrides: Partial<StepProps> = {}) {
  return render(
    <CheckoutLayoutProvider value={{ wide }}>
      <PaymentStep {...step(overrides)} />
    </CheckoutLayoutProvider>,
  );
}

const DELIVERY = {
  line1: "Rua Augusta, 1500 · ap 42",
  line2: "Consolação, São Paulo",
  onEdit: vi.fn(),
};
const LINES = [
  { key: "a", quantity: 2, name: "X-Burger", totalLabel: "R$ 36,00" },
  { key: "b", quantity: 1, name: "Refrigerante", totalLabel: "R$ 6,90" },
];

describe("on a computer (layout A)", () => {
  it("puts the order summary beside the payment, with its lines and total", () => {
    renderStep(true, { lines: LINES });

    expect(screen.getByTestId("payment-step").getAttribute("data-layout")).toBe(
      "wide",
    );
    expect(screen.getByText(layout.payHeading)).toBeTruthy();
    const summary = screen.getByTestId("checkout-summary");
    expect(summary.textContent).toContain(layout.summaryTitle);
    expect(summary.textContent).toContain("2× X-Burger");
    expect(summary.textContent).toContain("R$ 36,00");
    expect(screen.getByTestId("pay-bar-total").textContent).toBe("R$ 42,90");
  });

  it("draws the method choice as folder tabs over one panel", () => {
    renderStep(true, { method: "CARD" });

    const list = screen.getByRole("tablist", {
      name: PT_BR_CHECKOUT_SCREENS_COPY.method.groupLabel,
    });
    expect(list).toBeTruthy();
    const card = screen.getByRole("tab", { name: /Cartão/ });
    expect(card.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(card.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(card.id);
  });

  it("shows the address with both lines, and Alterar takes the buyer back to it", () => {
    const onEdit = vi.fn();
    renderStep(true, { delivery: { ...DELIVERY, onEdit } });

    const row = screen.getByTestId("checkout-address");
    expect(row.textContent).toContain("Rua Augusta, 1500 · ap 42");
    expect(row.textContent).toContain("Consolação, São Paulo");
    fireEvent.click(screen.getByRole("button", { name: layout.changeAddress }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("names the payer, and Alterar reopens Dados", () => {
    const onEditBuyer = vi.fn();
    renderStep(true, { onEditBuyer });

    expect(screen.getByTestId("checkout-payer-name").textContent).toBe(
      "Ana Compradora",
    );
    expect(screen.getByTestId("checkout-payer-cpf").textContent).toBe(
      "CPF já cadastrado",
    );
    fireEvent.click(screen.getByTestId("checkout-payer-edit"));
    expect(onEditBuyer).toHaveBeenCalledTimes(1);
  });

  it("mounts the host's note control in the summary", () => {
    renderStep(true, {
      orderNote: <button type="button">Adicionar observação ao pedido</button>,
    });

    expect(screen.getByTestId("checkout-summary").textContent).toContain(
      "Adicionar observação ao pedido",
    );
  });

  it("drops the lines while settling a balance, whose totals are the ticket's", () => {
    renderStep(true, {
      lines: LINES,
      totalOverride: { label: "R$ 10,00", items: 1 },
    });

    expect(screen.queryByTestId("checkout-summary-lines")).toBeNull();
    expect(screen.getByTestId("pay-bar-total").textContent).toBe("R$ 10,00");
  });
});

describe("on a phone (layout C)", () => {
  it("heads the step with the total, then the chips", () => {
    renderStep(false, { onEditBuyer: vi.fn(), delivery: DELIVERY });

    expect(screen.getByTestId("payment-step").getAttribute("data-layout")).toBe(
      "narrow",
    );
    expect(screen.getByText(layout.totalDueCaption(2))).toBeTruthy();
    expect(screen.queryByTestId("checkout-summary")).toBeNull();
    const chips = screen.getByTestId("checkout-chips");
    expect(chips.textContent).toContain("Ana Compradora · CPF ✓");
    // The chip shows the street line only.
    expect(chips.textContent).toContain("Rua Augusta, 1500 · ap 42");
    expect(chips.textContent).not.toContain("Consolação");
  });

  it("changes the address from its chip", () => {
    const onEdit = vi.fn();
    renderStep(false, { delivery: { ...DELIVERY, onEdit } });

    fireEvent.click(screen.getByRole("button", { name: /Alterar endereço/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("shows no address when the host passes none (Retirada, Mesa)", () => {
    renderStep(false);

    expect(screen.queryByTestId("checkout-address")).toBeNull();
  });
});

describe("the method tabs", () => {
  function Tabs(
    props: Partial<ComponentProps<typeof MethodTabs>>,
  ): JSX.Element {
    return (
      <MethodTabs
        idBase="t"
        shape="pill"
        value={null}
        onChange={vi.fn()}
        offered={["PIX", "CARD"]}
        {...props}
      />
    );
  }

  it("selects with the arrow keys and keeps one tab stop", () => {
    const onChange = vi.fn();
    render(<Tabs value="PIX" onChange={onChange} />);

    const pix = screen.getByRole("tab", { name: /Pix/ });
    const card = screen.getByRole("tab", { name: /Cartão/ });
    expect([pix.tabIndex, card.tabIndex]).toEqual([0, -1]);
    fireEvent.keyDown(pix, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("CARD");
    fireEvent.keyDown(pix, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("CARD");
  });

  it("disables a card the store cannot charge, and says why", () => {
    const onChange = vi.fn();
    render(<Tabs cardUnavailable onChange={onChange} />);

    const card = screen.getByTestId("checkout-method-CARD");
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.getAttribute("aria-label")).toContain(
      PT_BR_CHECKOUT_SCREENS_COPY.method.unavailableHere,
    );
    fireEvent.click(card);
    expect(onChange).not.toHaveBeenCalled();
    // The keys skip it too.
    fireEvent.keyDown(screen.getByTestId("checkout-method-PIX"), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenLastCalledWith("PIX");
  });
});

describe("the phone's pay bar", () => {
  it("shows the total beside the action on a phone", () => {
    render(
      <CheckoutLayoutProvider value={{ wide: false }}>
        <PayBarTotalProvider value="R$ 42,90">
          <StickyPayBar dataTestId="bar">
            <button type="button">Pagar</button>
          </StickyPayBar>
        </PayBarTotalProvider>
      </CheckoutLayoutProvider>,
    );

    expect(screen.getByTestId("pay-bar-sticky-total").textContent).toBe(
      "R$ 42,90",
    );
    expect(screen.getByTestId("bar").textContent).toContain(layout.total);
  });

  it("is just the action on a computer", () => {
    render(
      <CheckoutLayoutProvider value={{ wide: true }}>
        <PayBarTotalProvider value="R$ 42,90">
          <StickyPayBar dataTestId="bar">
            <button type="button">Pagar</button>
          </StickyPayBar>
        </PayBarTotalProvider>
      </CheckoutLayoutProvider>,
    );

    expect(screen.queryByTestId("pay-bar-sticky-total")).toBeNull();
  });
});

describe("the frame", () => {
  function Probe(): JSX.Element {
    const [wide, ref] = useWideLayout();
    return <div ref={ref} data-testid="probe" data-wide={String(wide)} />;
  }

  it(`is wide from ${WIDE_CHECKOUT_MIN}px of the container, narrow under it`, () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockReturnValue({ width: WIDE_CHECKOUT_MIN } as DOMRect);
    render(<Probe />);
    expect(screen.getByTestId("probe").getAttribute("data-wide")).toBe("true");
    cleanup();

    spy.mockReturnValue({ width: WIDE_CHECKOUT_MIN - 1 } as DOMRect);
    render(<Probe />);
    expect(screen.getByTestId("probe").getAttribute("data-wide")).toBe("false");
    spy.mockRestore();
  });
});

describe("the review's round-1 cases", () => {
  it("measures a frame that mounts AFTER the first render (the cart loads late)", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockReturnValue({ width: 1200 } as DOMRect);
    function Late(): JSX.Element {
      const [ready, setReady] = useState(false);
      const [wide, ref] = useWideLayout();
      return ready ? (
        <div ref={ref} data-testid="late" data-wide={String(wide)} />
      ) : (
        <button type="button" onClick={() => setReady(true)}>
          load
        </button>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByText("load"));
    expect(screen.getByTestId("late").getAttribute("data-wide")).toBe("true");
    spy.mockRestore();
  });

  it("keeps the payment body mounted when the frame flips (a tablet turned)", () => {
    function Flip(): JSX.Element {
      const [wide, setWide] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setWide((w) => !w)}>
            flip
          </button>
          <CheckoutLayoutProvider value={{ wide }}>
            <PaymentStep {...step({ method: "PIX" })} />
          </CheckoutLayoutProvider>
        </>
      );
    }
    render(<Flip />);
    const panel = screen.getByTestId("checkout-method-panel");
    fireEvent.click(screen.getByText("flip"));
    expect(screen.getByTestId("payment-step").getAttribute("data-layout")).toBe("narrow");
    // The same DOM node: React kept it, so nothing under it remounted.
    expect(screen.getByTestId("checkout-method-panel")).toBe(panel);
  });

  it("shows no payer when the buyer filled Dados in this checkout", () => {
    renderStep(true);
    expect(screen.queryByTestId("checkout-payer")).toBeNull();
  });

  it("does not raise again when a key lands on the tab already chosen", () => {
    const onChange = vi.fn();
    render(<MethodTabs idBase="t" shape="folder" value="PIX" onChange={onChange} offered={["PIX", "CARD"]} />);
    fireEvent.keyDown(screen.getByTestId("checkout-method-PIX"), { key: "Home" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("labels the panel only by a tab that is really chosen", () => {
    renderStep(true, {
      method: "CARD",
      providerConfig: {
        provider: "itau",
        tokenization: "NONE",
        publicKey: null,
        mockTokenization: false,
        methods: ["PIX"],
        chain: [
          {
            provider: "itau",
            displayName: "Itaú",
            tokenization: "NONE",
            publicKey: null,
            mockTokenization: false,
            methods: ["PIX"],
          },
        ],
      } as unknown as StepProps["providerConfig"],
    });
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("gives two flows on one page their own tab and panel ids", () => {
    render(
      <>
        <CheckoutLayoutProvider value={{ wide: true }}>
          <PaymentStep {...step({ method: "CARD" })} />
        </CheckoutLayoutProvider>
        <CheckoutLayoutProvider value={{ wide: true }}>
          <PaymentStep {...step({ method: "CARD" })} />
        </CheckoutLayoutProvider>
      </>,
    );
    const ids = screen.getAllByRole("tabpanel").map((panel) => panel.id);
    expect(new Set(ids).size).toBe(2);
  });
});
