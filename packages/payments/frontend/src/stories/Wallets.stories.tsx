import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

// Internal, deliberately: the assembled fast-lane story mounts the same
// non-exported screen `ProviderScreens.stories.tsx` reviews — the pane the
// factory places for a `pix-and-card` store — so the wallet chain is consumed
// where production consumes it.
import { PixAndCardScreen } from "../components/checkout/providers/pix-and-card";
import {
  APPLE_PAY_SUPPORTED_NETWORKS,
  ApplePayButton,
  applePayDeclared,
  applePaySupported,
  GooglePayButton,
  googlePayConfig,
} from "../index";
import type {
  ApplePayPaymentRequest,
  ApplePaySessionClass,
  ApplePaySessionLike,
  CheckoutChainLink,
  CheckoutOrder,
  CheckoutProviderConfig,
  GooglePayApi,
  GooglePaymentData,
  GooglePaymentsClient,
  PaymentFlows,
} from "../index";

import { raisePayable, StoryFlow } from "./host";
import type { StoryWorld } from "./store";

/**
 * The WALLET buttons on their own (FUT-471/472).
 *
 * `GooglePayButton` and `ApplePayButton` own token ACQUISITION only — the
 * charge, the polling and the outcome belong to the pane above them
 * (`wallet-pane.tsx`) — so unlike every sibling story file there is no
 * `StoryFlow`/store here: the buttons never talk to the wire. What a story
 * must fake instead is the BROWSER's wallet surface (`window.ApplePaySession`,
 * `google.payments.api`), the exact seams Safari and `pay.js` provide.
 *
 * The harness installs its Google stub at module scope because each harness
 * page is its own document. Stories share ONE document — and the render suite
 * imports every story module side by side — so the fakes here are scoped to a
 * story's subtree: installed DURING render (the Apple button feature-detects
 * synchronously in its own render, so an effect would be too late), restored
 * on unmount. Google's `pay.js` therefore never loads: the shipped loader
 * uses an installed global without a network request.
 */
const meta: Meta = {
  title: "Checkout/Wallets",
  parameters: {
    docs: {
      description: {
        component:
          "The wallet fast lane's buttons against a faked browser wallet surface: " +
          "ready, gated away (store half and device half), and the sheet resolving, " +
          "declining, cancelling or failing — every callback's payload logged below.",
      },
    },
  },
};
export default meta;

/** The payable the buttons charge against, as the pane would hand it over. */
const CARD_ORDER: CheckoutOrder = {
  orderId: "inv_2026_0044",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 7500,
  subtotalCents: 7500,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 75,00",
};

/**
 * A store whose chain head declares BOTH wallets, Google parameters published
 * — the everything-on baseline each override narrows. Provider names are
 * fictional on purpose (see `store-adapter.ts`).
 *
 * The shape is one the backend can actually produce: the projection derives
 * `mockTokenization = stub && publicKey === null` (`checkout/config.ts`), so a
 * published key and the mock grant are mutually exclusive by construction —
 * this is the stub connection, key withheld. `customerSchema` and
 * `checkoutScreen` ride along because a real `BuyerProviderLink` always
 * carries both; the assembled story below reads the same facts off a live
 * mount, which is what keeps this literal honest.
 */
function walletStore(overrides: Partial<CheckoutChainLink> = {}): CheckoutProviderConfig {
  return {
    provider: "aurora",
    tokenization: "PUBLIC_KEY",
    publicKey: null,
    mockTokenization: true,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "aurora",
        tokenization: "PUBLIC_KEY",
        publicKey: null,
        mockTokenization: true,
        methods: ["PIX", "CARD"],
        customerSchema: [{ key: "taxId", type: "CPF", required: true }],
        checkoutScreen: null,
        wallets: ["GOOGLE_PAY", "APPLE_PAY"],
        googlePay: { gateway: "aurora", gatewayMerchantId: "MID_LOJA_1" },
        ...overrides,
      },
    ],
  };
}

/** What each callback received, in order — the pane's seam, made visible. */
function CallbackLog({ entries }: { entries: string[] }): JSX.Element {
  return (
    <div style={{ opacity: 0.7, fontSize: 12 }}>
      <p style={{ margin: "12px 0 4px" }}>callbacks recebidos:</p>
      {entries.length === 0 ? (
        <p style={{ margin: 0 }}>— nenhum até agora —</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {entries.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google Pay — pay.js faked at the `google.payments.api` global
// ---------------------------------------------------------------------------

/** What the faked pay.js surface does for one story. */
interface GoogleSheetScript {
  /** `isReadyToPay`'s answer — the device half of Google's gate. */
  ready: boolean;
  /** How `loadPaymentData` settles once the sheet opens. */
  outcome: "authorize" | "dismiss" | "fail";
}

/**
 * A deterministic `google.payments.api`: the plain button stands in for the
 * one Google's script draws (that script is the ONE thing faked away), and
 * the sheet settles per the story's script. Rejections are plain
 * `{ statusCode }` objects because that is the shape Google rejects with —
 * the button's dismissal check reads exactly that field.
 */
function googlePayApiOf(script: GoogleSheetScript): GooglePayApi {
  class StoryPaymentsClient implements GooglePaymentsClient {
    isReadyToPay(): Promise<{ result: boolean }> {
      return Promise.resolve({ result: script.ready });
    }

    createButton(options: { onClick: () => void }): HTMLElement {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Pagar com Google Pay";
      button.addEventListener("click", options.onClick);
      return button;
    }

    async loadPaymentData(request: Record<string, unknown>): Promise<GooglePaymentData> {
      if (script.outcome === "dismiss") throw { statusCode: "CANCELED" };
      if (script.outcome === "fail") throw { statusCode: "DEVELOPER_ERROR" };
      // The price the sheet was asked for, echoed into the token — the story
      // shows the server-authoritative total reached the sheet.
      const info = request.transactionInfo as { totalPrice?: string } | undefined;
      return {
        paymentMethodData: {
          tokenizationData: { token: `gp_story_token_${info?.totalPrice ?? "?"}` },
        },
      };
    }
  }
  return { PaymentsClient: StoryPaymentsClient };
}

/** The buyer whose CPF the mount's default schema demands (FUT-595). */
const WALLET_BUYER = { name: "Ana Compradora", email: "ana@exemplo.com", taxId: "52998224725" };

/** The `window.google` slot, as far as these stories touch it. */
interface GoogleWindow {
  google?: { payments: { api: GooglePayApi } };
}

const googleScope = (): GoogleWindow => window as unknown as GoogleWindow;

/**
 * Scope a faked `google.payments.api` to ONE story's subtree: installed
 * during render — before the button's loader can look for it — and whatever
 * was there before restored on unmount, so nothing leaks into the next story.
 */
function WithGooglePayApi({
  api,
  children,
}: {
  api: GooglePayApi;
  children: ReactNode;
}): JSX.Element {
  const saved = useRef<{ previous: GoogleWindow["google"] } | null>(null);
  saved.current ??= { previous: googleScope().google };
  googleScope().google = { payments: { api } };
  useEffect(() => {
    // Re-asserted on mount: a StrictMode probe runs the cleanup once between
    // two mounts, and the story must stay faked after it.
    googleScope().google = { payments: { api } };
    return () => {
      const previous = saved.current?.previous;
      if (previous) googleScope().google = previous;
      else delete googleScope().google;
    };
  }, [api]);
  return <>{children}</>;
}

/**
 * The pane's Google seam, minus the charge: `googlePayConfig` gates mounting
 * exactly as `wallet-pane.tsx` does, and every callback lands in the log.
 */
function GooglePayDemo({
  config,
  sheet,
}: {
  config: CheckoutProviderConfig;
  sheet: GoogleSheetScript;
}): JSX.Element {
  const [log, setLog] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [api] = useState(() => googlePayApiOf(sheet));
  const push = (line: string): void =>
    setLog((prev) => [...prev, `${prev.length + 1} · ${line}`]);
  const params = googlePayConfig(config);
  return (
    <WithGooglePayApi api={api}>
      {params ? (
        <GooglePayButton
          order={CARD_ORDER}
          params={params}
          onKey={(key) => push(`onKey — chave: ${key}`)}
          onError={(message) => push(`onError: ${message}`)}
          onReady={() => setReady(true)}
        />
      ) : null}
      <div style={{ opacity: 0.7, fontSize: 12 }}>
        <p style={{ margin: "12px 0 0" }}>
          googlePayConfig: <code>{params ? JSON.stringify(params) : "null"}</code>
          {params ? "" : " — o botão nem chega a montar"}
        </p>
        <p style={{ margin: 0 }}>
          isReadyToPay aprovou: <code>{ready ? "sim" : "ainda não"}</code>
        </p>
      </div>
      <CallbackLog entries={log} />
    </WithGooglePayApi>
  );
}

/**
 * The published gate passed and `isReadyToPay` approved: the button renders,
 * and a click runs the sheet to a token — `onKey` receives the wallet key,
 * with the server-authoritative price visible inside the story token.
 */
export const GooglePayReady: StoryObj = {
  name: "Google Pay — pronto; o sheet entrega a chave",
  render: () => (
    <GooglePayDemo config={walletStore()} sheet={{ ready: true, outcome: "authorize" }} />
  ),
};

/**
 * The DEVICE half refuses: pay.js is present but `isReadyToPay` answers no.
 * Per Google's guide the buyer must never see a button that cannot work, so
 * nothing renders — in the pane, the card form remains the way to pay.
 */
export const GooglePayDeviceNotReady: StoryObj = {
  name: "Google Pay — isReadyToPay nega; nenhum botão",
  render: () => (
    <GooglePayDemo config={walletStore()} sheet={{ ready: false, outcome: "authorize" }} />
  ),
};

/**
 * The STORE half refuses, fail-closed: a capable browser, but the chain head
 * never declared `GOOGLE_PAY`, so `googlePayConfig` answers null and the
 * button is never even mounted.
 */
export const GooglePayNotDeclared: StoryObj = {
  name: "Google Pay — a loja não declarou; googlePayConfig → null",
  render: () => (
    <GooglePayDemo
      config={walletStore({ wallets: [], googlePay: null })}
      sheet={{ ready: true, outcome: "authorize" }}
    />
  ),
};

/**
 * The buyer closes the sheet. A dismissal is a choice, not a failure: neither
 * `onKey` nor `onError` fires, and the log stays empty however many times the
 * sheet is opened and closed again.
 */
export const GooglePaySheetDismissed: StoryObj = {
  name: "Google Pay — comprador fecha o sheet; nada acontece",
  render: () => (
    <GooglePayDemo config={walletStore()} sheet={{ ready: true, outcome: "dismiss" }} />
  ),
};

/** The sheet fails for real: `onError` gets the button's own pt-BR message. */
export const GooglePaySheetFails: StoryObj = {
  name: "Google Pay — o sheet falha; onError reporta",
  render: () => (
    <GooglePayDemo config={walletStore()} sheet={{ ready: true, outcome: "fail" }} />
  ),
};

// ---------------------------------------------------------------------------
// Apple Pay — Safari's `window.ApplePaySession` faked
// ---------------------------------------------------------------------------

/** What the faked session does across one run. */
interface AppleSheetScript {
  /** `canMakePayments()`'s answer — the device half of the gate. */
  canPay: boolean;
  /** Confirm the payment, or close the sheet without confirming. */
  sheet: "authorize" | "cancel";
  /** Observes `completePayment` — how a story shows the sheet's honest close. */
  onComplete?: (status: number) => void;
}

/**
 * A deterministic `ApplePaySession`, in Safari's own order: `begin` asks for
 * merchant validation, a validated merchant puts the sheet up, and the buyer
 * then confirms (`authorize`) or closes it (`cancel`) — synchronously, so no
 * story ever waits on a timer.
 */
function applePaySessionOf(script: AppleSheetScript): ApplePaySessionClass {
  class StorySession implements ApplePaySessionLike {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      return script.canPay;
    }

    onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
    onpaymentauthorized:
      | ((event: { payment: { token: { paymentData: unknown } } }) => void)
      | null = null;
    oncancel: (() => void) | null = null;

    private readonly request: ApplePayPaymentRequest;

    constructor(_version: number, request: ApplePayPaymentRequest) {
      this.request = request;
    }

    begin(): void {
      this.onvalidatemerchant?.({ validationURL: "https://carteira.exemplo/validar" });
    }

    abort(): void {
      // Nothing to tear down — the stub keeps no timers.
    }

    completeMerchantValidation(): void {
      if (script.sheet === "cancel") {
        this.oncancel?.();
        return;
      }
      this.onpaymentauthorized?.({
        payment: {
          token: {
            // The networks the sheet was asked for, echoed into the opaque
            // payload — the Visa/Mastercard-only rule stays visible in the key.
            paymentData: { stub: true, networks: this.request.supportedNetworks },
          },
        },
      });
    }

    completePayment(result: { status: number }): void {
      script.onComplete?.(result.status);
    }
  }
  return StorySession;
}

const appleScope = (): { ApplePaySession?: ApplePaySessionClass } =>
  window as unknown as { ApplePaySession?: ApplePaySessionClass };

/** Install (or force-remove, `null`) the session class on `window`. */
function setApplePaySession(Session: ApplePaySessionClass | null): void {
  if (Session) appleScope().ApplePaySession = Session;
  else delete appleScope().ApplePaySession;
}

/**
 * Scope `window.ApplePaySession` to ONE story's subtree — `null` pins the
 * global ABSENT (every non-Safari browser), so the no-device story stays
 * honest even after a stubbed story ran. Installed during render because the
 * button feature-detects synchronously in its own render; whatever was there
 * before is restored on unmount.
 */
function WithApplePaySession({
  Session,
  children,
}: {
  Session: ApplePaySessionClass | null;
  children: ReactNode;
}): JSX.Element {
  const saved = useRef<{ previous: ApplePaySessionClass | undefined } | null>(null);
  saved.current ??= { previous: appleScope().ApplePaySession };
  setApplePaySession(Session);
  useEffect(() => {
    // Re-asserted on mount: a StrictMode probe runs the cleanup once between
    // two mounts, and the story must stay faked after it.
    setApplePaySession(Session);
    return () => setApplePaySession(saved.current?.previous ?? null);
  }, [Session]);
  return <>{children}</>;
}

/** Rendered INSIDE the scoped global, so the verdict reads the story's fake. */
function AppleVerdict(): JSX.Element {
  return (
    <p style={{ opacity: 0.7, fontSize: 12, margin: "12px 0 0" }}>
      applePaySupported(): <code>{String(applePaySupported())}</code>
    </p>
  );
}

/**
 * The pane's Apple seam, minus the charge: the demo answers `onAuthorized`
 * per the story (`accept`), which is what drives the sheet's honest close —
 * STATUS_SUCCESS or STATUS_FAILURE — and logs everything it saw.
 */
function ApplePayDemo({
  device = "ready",
  sheet = "authorize",
  accept = true,
  validation = "wired",
}: {
  device?: "ready" | "absent";
  sheet?: "authorize" | "cancel";
  accept?: boolean;
  validation?: "wired" | "missing" | "rejects";
}): JSX.Element {
  const [log, setLog] = useState<string[]>([]);
  const push = (line: string): void =>
    setLog((prev) => [...prev, `${prev.length + 1} · ${line}`]);
  const [Session] = useState(() =>
    device === "absent"
      ? null
      : applePaySessionOf({
          canPay: true,
          sheet,
          onComplete: (status) =>
            push(`completePayment: ${status === 0 ? "STATUS_SUCCESS" : "STATUS_FAILURE"}`),
        }),
  );
  const validateMerchant =
    validation === "wired"
      ? (): Promise<unknown> => Promise.resolve({ merchantSession: "sessao-aurora" })
      : validation === "rejects"
        ? (): Promise<unknown> =>
            Promise.reject(new Error("o host não obteve a sessão do comerciante"))
        : undefined;
  return (
    <WithApplePaySession Session={Session}>
      <ApplePayButton
        order={CARD_ORDER}
        onAuthorized={(key) => {
          push(`onAuthorized — chave: ${key}`);
          return Promise.resolve(accept);
        }}
        onError={(message) => push(`onError: ${message}`)}
        validateMerchant={validateMerchant}
      />
      <AppleVerdict />
      <CallbackLog entries={log} />
    </WithApplePaySession>
  );
}

/**
 * Feature-detect passes and a click runs the whole session: merchant
 * validation through the host's port, the buyer confirms, `onAuthorized`
 * receives the serialized `token.paymentData` and resolves true — so the
 * sheet is completed with STATUS_SUCCESS. (Outside Safari the pixels are the
 * fallback block, not Apple's drawn button — only Safari applies
 * `-apple-pay-button`.)
 */
export const ApplePayReady: StoryObj = {
  name: "Apple Pay — pronto; autoriza e fecha com STATUS_SUCCESS",
  render: () => <ApplePayDemo />,
};

/**
 * No `ApplePaySession` anywhere — every non-Safari browser. The button
 * renders NOTHING, deliberately: the buyer loses a shortcut, never the
 * ability to pay, because the card form the pane always renders stays.
 */
export const ApplePayNoDevice: StoryObj = {
  name: "Apple Pay — aparelho sem ApplePaySession; sem botão",
  render: () => (
    <>
      <ApplePayDemo device="absent" />
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        (nenhum botão acima — sem o atalho, o formulário de cartão continua sendo o caminho)
      </p>
    </>
  ),
};

/**
 * The charge is refused: `onAuthorized` resolves false, and the button
 * completes the sheet with STATUS_FAILURE — the honest close Apple requires,
 * never a success over a refused charge.
 */
export const ApplePayChargeDeclined: StoryObj = {
  name: "Apple Pay — cobrança recusada; fecha com STATUS_FAILURE",
  render: () => <ApplePayDemo accept={false} />,
};

/** The buyer closes the sheet: `oncancel`, and nothing else — no key, no error. */
export const ApplePaySheetCancelled: StoryObj = {
  name: "Apple Pay — comprador fecha o sheet; nada acontece",
  render: () => <ApplePayDemo sheet="cancel" />,
};

/**
 * The host wired no merchant-validation port (the Apple-side prerequisites
 * are not done): the session aborts before any sheet and `onError` carries
 * the button's own pt-BR explanation — the card form stays the way to pay.
 */
export const ApplePayValidationMissing: StoryObj = {
  name: "Apple Pay — sem validação de comerciante; aborta e explica",
  render: () => <ApplePayDemo validation="missing" />,
};

/**
 * The port IS wired and Apple's server (through it) REFUSES the merchant —
 * expired certificate, unregistered domain. Drive it: a click asks the host
 * port, the rejection aborts the session before any sheet, and `onError`
 * carries the OTHER sentence — "Tente novamente ou pague com cartão" — because
 * a validation that failed may pass on retry, where the missing-port case
 * (story above) cannot and says only "Pague com cartão".
 */
export const ApplePayValidationRejected: StoryObj = {
  name: "Apple Pay — validação de comerciante recusada; aborta",
  render: () => <ApplePayDemo validation="rejects" />,
};

// ---------------------------------------------------------------------------
// The capability gates, side by side
// ---------------------------------------------------------------------------

/** `applePaySupported()` under a scoped global: installed, asked, restored. */
function supportedWith(Session: ApplePaySessionClass | null): boolean {
  const previous = appleScope().ApplePaySession;
  setApplePaySession(Session);
  const verdict = applePaySupported();
  setApplePaySession(previous ?? null);
  return verdict;
}

function GateList({ title, rows }: { title: string; rows: [string, string][] }): JSX.Element {
  return (
    <div style={{ fontSize: 13 }}>
      <p style={{ margin: "12px 0 4px", fontWeight: 600 }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {rows.map(([label, verdict]) => (
          <li key={label}>
            {label} → <code>{verdict}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Every clause of the two store-side gates (`googlePayConfig` and
 * `applePayDeclared`, both fail-closed) and of the device-side one
 * (`applePaySupported`, evaluated live under scoped fakes) — the exact reads
 * `wallet-pane.tsx` composes before either button may mount.
 */
/** A config with NO chain at all — what an older host publishes. */
function chainlessStore(): CheckoutProviderConfig {
  const head = { ...walletStore() };
  delete head.chain;
  return head;
}

/** A chain that PREDATES the wallet fields — neither declared nor null. */
function preWalletStore(): CheckoutProviderConfig {
  const base = walletStore();
  const chain = (base.chain ?? []).map((entry) => {
    const bare = { ...entry };
    delete bare.wallets;
    delete bare.googlePay;
    return bare;
  });
  return { ...base, chain };
}

/** `canMakePayments()` THROWS — old Safari behind a policy; treated as no. */
function throwingSession(): ApplePaySessionClass {
  class ThrowingSession {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      throw new Error("bloqueado por política");
    }
  }
  return ThrowingSession as unknown as ApplePaySessionClass;
}

export const CapabilityGates: StoryObj = {
  name: "Os portões — googlePayConfig · applePayDeclared · applePaySupported",
  render: () => {
    const show = (params: ReturnType<typeof googlePayConfig>): string =>
      params ? JSON.stringify(params) : "null";
    return (
      <>
        <GateList
          title="googlePayConfig — a metade da LOJA, fail-closed"
          rows={[
            ["cabeça com CARD + GOOGLE_PAY + parâmetros", show(googlePayConfig(walletStore()))],
            ["cabeça sem a carteira", show(googlePayConfig(walletStore({ wallets: [] })))],
            [
              "gatewayMerchantId ausente",
              show(
                googlePayConfig(
                  walletStore({ googlePay: { gateway: "aurora", gatewayMerchantId: null } }),
                ),
              ),
            ],
            ["cabeça sem CARD", show(googlePayConfig(walletStore({ methods: ["PIX"] })))],
            ["config sem chain (host antigo)", show(googlePayConfig(chainlessStore()))],
            ["config nula (ainda carregando)", show(googlePayConfig(null))],
          ]}
        />
        <GateList
          title="applePayDeclared — a metade da LOJA"
          rows={[
            ["cabeça declara APPLE_PAY", String(applePayDeclared(walletStore()))],
            [
              "cabeça sem a carteira",
              String(applePayDeclared(walletStore({ wallets: ["GOOGLE_PAY"] }))),
            ],
            [
              "cabeça anterior ao campo wallets (host antigo)",
              String(applePayDeclared(preWalletStore())),
            ],
            ["cabeça sem CARD", String(applePayDeclared(walletStore({ methods: ["PIX"] })))],
            ["config nula (ainda carregando)", String(applePayDeclared(null))],
          ]}
        />
        <GateList
          title="applePaySupported — a metade do APARELHO"
          rows={[
            ["sem ApplePaySession", String(supportedWith(null))],
            [
              "com sessão, canMakePayments() nega",
              String(supportedWith(applePaySessionOf({ canPay: false, sheet: "authorize" }))),
            ],
            [
              "com sessão, canMakePayments() lança (tratado como não)",
              String(supportedWith(throwingSession())),
            ],
            [
              "com sessão, canMakePayments() aprova",
              String(supportedWith(applePaySessionOf({ canPay: true, sheet: "authorize" }))),
            ],
          ]}
        />
        <p style={{ fontSize: 13, margin: "12px 0 0" }}>
          APPLE_PAY_SUPPORTED_NETWORKS → <code>{APPLE_PAY_SUPPORTED_NETWORKS.join(", ")}</code>
        </p>
      </>
    );
  },
};

// ---------------------------------------------------------------------------
// The fast lane ASSEMBLED — the pane, on a real mount that declares wallets
// ---------------------------------------------------------------------------

/**
 * The pane's half of the story, everything from the MOUNT: the config is
 * `flows.useCheckoutConfig()`'s read (the real projection publishing the chain
 * head's `wallets` + `googlePay` — the button demos above hand-build exactly
 * this shape), and the order is a payable RAISED on the mount, not a literal.
 * If the projection dropped either wallet field, the buttons here vanish and
 * the render suite's markers fail — which is the tripwire the hand-built
 * stories cannot be.
 */
function AssembledPane({
  flows,
  world,
}: {
  flows: PaymentFlows;
  world: StoryWorld;
}): JSX.Element | null {
  const { config } = flows.useCheckoutConfig();
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  useEffect(() => {
    void raisePayable(world, { method: "CARD", buyer: WALLET_BUYER, saveProfile: false }).then(
      (result) => {
        if (result.ok) setOrder(result.data);
      },
    );
  }, [world]);
  if (!config || !order) return null;
  return (
    <>
      <PixAndCardScreen
        order={order}
        buyer={WALLET_BUYER}
        config={config}
        method="CARD"
        onResolved={(status) => setOutcome(status)}
        validateApplePayMerchant={() => Promise.resolve({ merchantSession: "sessao-aurora" })}
      />
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        onResolved: <code>{outcome ?? "— ainda nada —"}</code>
      </p>
    </>
  );
}

/**
 * `WalletCardPane`, whole (FUT-471/472/563): both wallet buttons above the
 * divider — "ou pague com cartão" renders only once something sits over it —
 * and the full card form below, none of it replaced or duplicated by the
 * wallet lane. The chain head declares both wallets ON THE STORE
 * (`store-adapter.ts` publishes them through the real gateway stamp), the
 * fakes supply the DEVICE half, and `PixAndCardScreen` is the same resolution
 * step production takes to reach the pane.
 *
 * Drive it: either wallet runs its sheet to a key and charges the mount for
 * real — the pane swaps every pay control for the processing state while it
 * does (one charge at a time, by construction) and `onResolved` reports the
 * landed status underneath.
 */
export const WalletFastLaneAssembled: StoryObj = {
  name: "A via rápida montada — botões, divisor e formulário",
  render: () => (
    <WalletSurface>
      <StoryFlow
        spec={{
          chain: [
            {
              name: "aurora",
              methods: ["PIX", "CARD"],
              stub: true,
              publicKey: null,
              wallets: ["GOOGLE_PAY", "APPLE_PAY"],
              googlePayMerchantId: "MID_LOJA_1",
            },
          ],
        }}
      >
        {(flows, world) => (
          <flows.Provider>
            <AssembledPane flows={flows} world={world} />
          </flows.Provider>
        )}
      </StoryFlow>
    </WalletSurface>
  ),
};

/** Both browser wallet surfaces, scoped to the assembled story's subtree. */
function WalletSurface({ children }: { children: ReactNode }): JSX.Element {
  const [api] = useState(() => googlePayApiOf({ ready: true, outcome: "authorize" }));
  const [Session] = useState(() => applePaySessionOf({ canPay: true, sheet: "authorize" }));
  return (
    <WithGooglePayApi api={api}>
      <WithApplePaySession Session={Session}>{children}</WithApplePaySession>
    </WithGooglePayApi>
  );
}
