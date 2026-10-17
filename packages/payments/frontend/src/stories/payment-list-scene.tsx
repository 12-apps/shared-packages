/**
 * The HOST around the one-list Pagamento's stories (FUT-3591/3592): the door
 * options, the bar's lines, the page and the step card — and the two things a
 * host changes under a raised payment, as controls drawn above the step:
 * "Adicionar um item" (the cart moves) and "Pausar a loja" (the host holds
 * the button).
 *
 * None of it is part of the package. The door options are a host's
 * `CheckoutDoorOption[]` kept as plain state; the real ones come from the
 * host's own settlement package.
 */
import { Box, Chip } from "@mui/material";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import type { StoryObj } from "@storybook/react-vite";

import { PT_BR_PAYMENT_LIST_COPY } from "../components/checkout/list/pt-BR";
import type { GooglePayApi, GooglePaymentData, GooglePaymentsClient } from "../components/checkout/google-pay-button";
import type { CheckoutCartView, CheckoutDoorOption, CheckoutPaymentList } from "../index";

import { StoryFlow, type StoryHost } from "./host";
import { brlLabel, type StorySpec } from "./store";
import type { StoryProvider } from "./store-adapter";

export const ON_PAGE: StoryProvider = { name: "aurora", methods: ["PIX", "CARD"], stub: true, publicKey: null, checkoutScreen: "pix-and-card" };
export const SAVED = [{ id: "vault_1", last4: "4242", brand: "Visa", expMonth: 11, expYear: 2032 }];

/**
 * The story mount keeps no buyer profile, so "CPF on file" is played by a CPF
 * the host already holds in the buyer it passes — a real host's server reads
 * the saved one instead.
 */
export const ON_FILE = { name: "Ana Teste", taxId: "529.982.247-25" };

/** What the host changes under the step, from the controls above it. */
interface HostControls {
  bumped: boolean;
  held: boolean;
}

const Controls = createContext<HostControls>({ bumped: false, held: false });

/** A host's two door options, with the troco question as plain chips. */
function useDemoDoor(): CheckoutDoorOption[] {
  const [troco, setTroco] = useState<string | null>(null);
  return [
    {
      id: "cash",
      label: "Dinheiro",
      action: "Enviar pedido",
      blocked: troco === null ? "Diga se precisa de troco." : null,
      onSend: () => undefined,
      content: (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box component="span" sx={{ typography: "body2", fontWeight: 600 }}>Precisa de troco?</Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {["Não preciso", "R$ 30", "R$ 40", "R$ 50"].map((label) => (
              <Chip key={label} label={label} clickable color={troco === label ? "primary" : "default"} onClick={() => setTroco(label)} />
            ))}
          </Box>
        </Box>
      ),
    },
    {
      id: "reader",
      label: "Maquininha",
      hint: "Crédito, débito, vale-refeição ou Pix",
      hideHintWhileChosen: true,
      action: "Enviar pedido",
      blocked: null,
      onSend: () => undefined,
      content: (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, typography: "body2", color: "text.secondary" }}>
          <span><b>Crédito</b>: Visa, Mastercard, Elo, Amex, Hipercard e Diners</span>
          <span><b>Débito</b>: Visa, Mastercard e Elo</span>
          <span><b>Pix</b>: o entregador mostra o QR na maquininha</span>
        </Box>
      ),
    },
  ];
}

/** The cart's two prices — the second after "Adicionar um item". */
export const CART_CENTS = { before: 2700, after: 3400 };

function useDemoList(withDoor: boolean, totalCents: number | undefined, amountDueLabel: string | undefined): CheckoutPaymentList {
  const door = useDemoDoor();
  const { held, bumped } = useContext(Controls);
  return useMemo(
    () => ({
      copy: PT_BR_PAYMENT_LIST_COPY,
      summary: <Box component="span" sx={{ typography: "body2" }}>{bumped ? "3 itens" : "2 itens"} · Taxa de entrega R$ 5,00</Box>,
      onlineExtras: (
        <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1, typography: "body2" }}>
          <input type="checkbox" defaultChecked /> Usar meus R$ 5,00 de crédito na loja
        </Box>
      ),
      door: withDoor ? door : [],
      hold: held ? { action: "Loja pausada", reason: "A loja pausou os pedidos por alguns minutos." } : null,
      ...(totalCents === undefined ? {} : { totalCents: bumped ? CART_CENTS.after : totalCents }),
      ...(amountDueLabel ? { amountDueLabel } : {}),
    }),
    [door, withDoor, held, bumped, totalCents, amountDueLabel],
  );
}

/** The basket the host reads, and the one after "Adicionar um item". */
function useDemoCart(): Partial<CheckoutCartView> {
  const { bumped } = useContext(Controls);
  const cents = bumped ? CART_CENTS.after : CART_CENTS.before;
  return { totalLabel: brlLabel(cents), totalItems: bumped ? 3 : 2, identity: { signature: bumped ? "x1|3" : "x1|2", ready: true } };
}

/** The host's chrome around the step: page, 512px column (or the computer's whole width), the step card. */
function HostFrame({ controls, desktop = false, children }: { controls: ReactNode; desktop?: boolean; children: ReactNode }): JSX.Element {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", px: desktop ? 8 : 2, pt: desktop ? 4 : 2 }}>
      <Box sx={{ maxWidth: desktop ? 1152 : 512, mx: "auto", display: "flex", flexDirection: "column", gap: 1.5 }}>
        {controls}
        <Box sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", borderRadius: 3, boxShadow: 1, p: 1.75, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, typography: "subtitle1", fontWeight: 700 }}>
            <Box sx={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid", borderColor: "primary.main", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem" }}>4</Box>
            Pagamento
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/** "Adicionar um item" and "Pausar a loja" — the host's own buttons, not the package's. */
function ControlChips({ state, set }: { state: HostControls; set: (next: HostControls) => void }): JSX.Element {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      <Chip size="small" variant="outlined" label={state.bumped ? "Tirar o item" : "Adicionar um item"} onClick={() => set({ ...state, bumped: !state.bumped })} data-testid="host-bump-cart" />
      <Chip size="small" variant="outlined" label={state.held ? "Reabrir a loja" : "Pausar a loja"} onClick={() => set({ ...state, held: !state.held })} data-testid="host-hold" />
    </Box>
  );
}

/** What a scene adds to the store spec and the host. */
interface SceneOptions {
  withDoor?: boolean;
  /** The sheet's price, which is also what makes a Google Pay row possible. */
  totalCents?: number;
  /** Draw "Adicionar um item" / "Pausar a loja" above the step. */
  controls?: boolean;
  /** Install a faked `google.payments.api` for the scene. */
  googlePay?: boolean;
  /** Install a faked `ApplePaySession` for the scene, and answer the host's merchant validation. */
  applePay?: boolean;
  /** A balance the host holds pays part of the cart: what is left, formatted (store credit, E11). */
  amountDueLabel?: string;
  /** The computer's layout: the whole width, the "Resumo do pedido" column beside the step (L4). */
  desktop?: boolean;
}

export function scene(spec: StorySpec, host: StoryHost, options: SceneOptions = {}): StoryObj {
  const { withDoor = true, totalCents, controls = false, desktop = false } = options;
  // The list is the host's HOOK, called inside the checkout on every render —
  // so the door options' own state (the troco answer) reaches the bar.
  const usePaymentList = (): CheckoutPaymentList => useDemoList(withDoor, totalCents, options.amountDueLabel);
  const full: StoryHost = {
    ...host,
    usePaymentList,
    ...(controls ? { useCart: useDemoCart } : {}),
    ...(options.applePay ? { validateApplePayMerchant: async () => ({ merchantSession: "story" }) } : {}),
    cart: { lines: DEMO_LINES, discountLines: DEMO_FEE, ...host.cart },
  };
  function Scene(): JSX.Element {
    const [state, set] = useState<HostControls>({ bumped: false, held: false });
    const body = (
      <Controls.Provider value={state}>
        <StoryFlow spec={spec} host={full}>
          {(flows) => (
            <HostFrame controls={controls ? <ControlChips state={state} set={set} /> : null} desktop={desktop}>
              <flows.Checkout />
            </HostFrame>
          )}
        </StoryFlow>
      </Controls.Provider>
    );
    const withApple = options.applePay ? <WithApplePay>{body}</WithApplePay> : body;
    return options.googlePay ? <WithGooglePay>{withApple}</WithGooglePay> : withApple;
  }
  return { render: () => <Scene />, ...(desktop ? { parameters: { layout: "fullscreen", wide: true } } : {}) };
}

/** The cart's lines and the delivery fee, as a host words them — what the computer's summary column lists. */
const DEMO_LINES = [
  { key: "combo", quantity: 1, name: "Combo", totalLabel: "R$ 15,00" },
  { key: "suco", quantity: 1, name: "Suco de laranja", totalLabel: "R$ 7,00" },
];
const DEMO_FEE = (
  <Box sx={{ display: "flex", justifyContent: "space-between", typography: "body2" }}>
    <span>Taxa de entrega</span>
    <span>R$ 5,00</span>
  </Box>
);

/**
 * Safari's `ApplePaySession`, faked for one scene: the device can pay, the
 * merchant validates, and the sheet authorises as soon as it opens — so the
 * story plays the whole run in a browser that has no Apple Pay.
 */
class StoryApplePaySession {
  static readonly STATUS_SUCCESS = 0;
  static readonly STATUS_FAILURE = 1;
  static canMakePayments(): boolean {
    return true;
  }
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
  onpaymentauthorized: ((event: { payment: { token: { paymentData: unknown } } }) => void) | null = null;
  oncancel: (() => void) | null = null;
  private readonly amount: string;
  constructor(_version: number, request: { total: { amount: string } }) {
    this.amount = request.total.amount;
  }
  begin(): void {
    this.onvalidatemerchant?.({ validationURL: "https://apple-pay-gateway.apple.com/story" });
  }
  abort(): void {}
  completeMerchantValidation(): void {
    this.onpaymentauthorized?.({ payment: { token: { paymentData: { story: true, amount: this.amount } } } });
  }
  completePayment(): void {}
}

interface AppleWindow {
  ApplePaySession?: unknown;
}

/** Installed during render — before the list's feature-detect — and removed on unmount. */
function WithApplePay({ children }: { children: ReactNode }): JSX.Element {
  const scope = window as unknown as AppleWindow;
  scope.ApplePaySession = StoryApplePaySession;
  useEffect(() => {
    scope.ApplePaySession = StoryApplePaySession;
    return () => {
      delete scope.ApplePaySession;
    };
  }, [scope]);
  return <>{children}</>;
}

/**
 * Google's `pay.js`, faked at the `google.payments.api` global for one scene:
 * a plain button stands in for the one `createButton` draws, and the sheet
 * authorises at whatever price it was asked for.
 */
class StoryPaymentsClient implements GooglePaymentsClient {
  isReadyToPay(): Promise<{ result: boolean }> {
    return Promise.resolve({ result: true });
  }

  createButton(options: { onClick: () => void; buttonRadius?: number }): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Pagar com Google Pay";
    // Google draws its own button; this stand-in only mimics its black pill.
    button.style.cssText = `width:100%;height:100%;min-height:44px;border-radius:${options.buttonRadius ?? 22}px;border:0;background:#000;color:#fff;font:600 15px system-ui`;
    button.addEventListener("click", options.onClick);
    return button;
  }

  loadPaymentData(request: Record<string, unknown>): Promise<GooglePaymentData> {
    const info = request.transactionInfo as { totalPrice?: string } | undefined;
    return Promise.resolve({ paymentMethodData: { tokenizationData: { token: `gp_story_token_${info?.totalPrice ?? "?"}` } } });
  }
}

const GOOGLE_API: GooglePayApi = { PaymentsClient: StoryPaymentsClient };

interface GoogleWindow {
  google?: { payments: { api: GooglePayApi } };
}

/** Installed during render — before the list's loader looks — and restored on unmount. */
function WithGooglePay({ children }: { children: ReactNode }): JSX.Element {
  const scope = window as unknown as GoogleWindow;
  const saved = useRef<{ previous: GoogleWindow["google"] } | null>(null);
  saved.current ??= { previous: scope.google };
  scope.google = { payments: { api: GOOGLE_API } };
  useEffect(() => {
    scope.google = { payments: { api: GOOGLE_API } };
    return () => {
      const previous = saved.current?.previous;
      if (previous) scope.google = previous;
      else delete scope.google;
    };
  }, [scope]);
  return <>{children}</>;
}
