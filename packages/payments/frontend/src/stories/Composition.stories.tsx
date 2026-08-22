import { useEffect, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CheckoutComponents } from "../components/checkout/ui";
import {
  CardPayBar,
  CheckoutComponentsProvider,
  createCheckoutClient,
  NewCardForm,
  detectBrand,
  onlyDigits,
  type CardDetails,
  type CardFieldErrors,
  type CheckoutProviderConfig,
} from "../index";

import { StoryFlow, storyFlows } from "./host";
import { CheckoutCopyProvider } from "../components/checkout/copy-context";
import { STORY_CHECKOUT_COPY } from "./demo-copy";

/**
 * The two claims that are not about any single screen (FUT-741/742).
 *
 * 1. A SECOND HOST really can bring its own design system. The slot contract
 *    (`ui.tsx`) has always said so; this puts the same flow twice on one page,
 *    once through the raw-MUI defaults and once through a deliberately foreign
 *    look, so the claim is checkable by eye rather than by reading a type.
 *
 * 2. The FLAT exports still work. `createPaymentFlows` is additive — the
 *    hand-composed path is the escape hatch, and an escape hatch nobody
 *    exercises is one that quietly stops working.
 */
const meta: Meta = { title: "Checkout/Composition" };
export default meta;

const STUB = { stub: true, publicKey: null } as const;

/**
 * A design system that looks like nothing in this repo. Every slot is filled
 * with plain elements and hard, unmistakable styling — the point is that it is
 * obviously NOT MUI, so a story where the two halves look alike is a failure.
 */
const foreignComponents: Partial<CheckoutComponents> = {
  Text: ({ children, ...rest }) => (
    <span
      data-testid={rest["data-testid"]}
      style={{ fontFamily: "Georgia, serif", letterSpacing: "0.02em" }}
    >
      {children}
    </span>
  ),
  Button: ({ children, onClick, disabled, dataTestId }) => (
    <button
      type="button"
      data-testid={dataTestId}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "#14532d",
        color: "#f0fdf4",
        border: "2px solid #052e16",
        borderRadius: 0,
        padding: "10px 18px",
        fontFamily: "Georgia, serif",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  ),
  Input: ({ label, value, onChange, helperText, error, required, ...rest }) => (
    <label style={{ display: "block", fontFamily: "Georgia, serif" }}>
      <span style={{ display: "block", fontSize: 12 }}>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        data-testid={rest["data-testid"]}
        value={value}
        onChange={onChange}
        placeholder={rest.placeholder}
        style={{
          width: "100%",
          padding: 8,
          border: `2px solid ${error ? "#b91c1c" : "#14532d"}`,
          borderRadius: 0,
          fontFamily: "Georgia, serif",
        }}
      />
      {helperText ? (
        <span style={{ fontSize: 11, color: error ? "#b91c1c" : "#334155" }}>{helperText}</span>
      ) : null}
    </label>
  ),
  Alert: ({ title, description, ...rest }) => (
    <div
      data-testid={rest["data-testid"]}
      style={{ border: "2px dashed #14532d", padding: 12, fontFamily: "Georgia, serif" }}
    >
      <strong>{title}</strong>
      <div>{description}</div>
    </div>
  ),
  ActionBar: ({ children, dataTestId }) => (
    <div data-testid={dataTestId} style={{ borderTop: "4px double #14532d", paddingTop: 12 }}>
      {children}
    </div>
  ),
};

/**
 * THE SAME FLOW, TWICE. Left: the raw-MUI defaults a host with no design
 * system gets for free. Right: a foreign one, filled once at the factory
 * instead of threaded through every screen.
 */
export const SlotsSideBySide: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <section>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", opacity: 0.6 }}>
          slots padrão (MUI)
        </h3>
        <StoryFlow spec={{ chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }] }}>
          {(flows) => <flows.Checkout />}
        </StoryFlow>
      </section>
      <section>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", opacity: 0.6 }}>
          design system do host
        </h3>
        <StoryFlow
          spec={{ chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }] }}
          host={{ components: foreignComponents }}
        >
          {(flows) => <flows.Checkout />}
        </StoryFlow>
      </section>
    </div>
  ),
};

/**
 * THE ESCAPE HATCH: the flat exports, composed BY HAND with no factory in
 * sight.
 *
 * `createPaymentFlows` is additive, and an escape hatch nobody exercises is one
 * that quietly stops working. This story imports only what `@12-apps/payments-
 * frontend` has always exported from `.` — a bound client, the slot provider,
 * the card form and the pay bar — and wires them itself, against the same real
 * mount every other story runs on.
 */
export const HeadlessByHand: StoryObj = {
  render: () => <HandComposed />,
};

function HandComposed(): JSX.Element {
  // The world is built once per mount; only its transport is used below, so
  // nothing about the factory is involved in this story at all.
  const [world] = useState(
    () => storyFlows({ chain: [{ name: "aurora", methods: ["CARD"], ...STUB }] }).world,
  );
  const [client] = useState(() => createCheckoutClient({ fetchImpl: world.fetchImpl }));
  const [config, setConfig] = useState<CheckoutProviderConfig | null>(null);
  const [card, setCard] = useState<CardDetails>({ number: "", holder: "", expiry: "", cvv: "" });
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [saveCard, setSaveCard] = useState(false);

  useEffect(() => {
    let active = true;
    void client.getConfig("loja-1").then((result) => {
      if (active && result.ok) setConfig(result.data);
    });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <CheckoutComponentsProvider>
      <CheckoutCopyProvider copy={STORY_CHECKOUT_COPY.views.screens}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Composto à mão: <code>createCheckoutClient</code> +{" "}
            <code>CheckoutComponentsProvider</code> + <code>NewCardForm</code> +{" "}
            <code>CardPayBar</code>. Nenhuma fábrica envolvida.
          </p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            /config respondeu com {config?.chain?.length ?? 0} provedor(es); tokenização{" "}
            <code>{config?.tokenization ?? "—"}</code>.
          </p>
          <NewCardForm
            card={card}
            fieldErrors={fieldErrors}
            brand={detectBrand(onlyDigits(card.number))}
            saveCard={saveCard}
            setCard={setCard}
            setFieldErrors={setFieldErrors}
            onSaveCardChange={setSaveCard}
          />
          <CardPayBar totalLabel="R$ 75,00" submitting={false} onPay={() => undefined} />
        </div>
      </CheckoutCopyProvider>
    </CheckoutComponentsProvider>
  );
}
