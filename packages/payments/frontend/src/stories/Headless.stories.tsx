import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ClientChargeView } from "@12-apps/payments-backend";

import {
  createPaymentsClient,
  isSettled,
  PaymentsProvider,
  useChargeStatus,
  useCreateCharge,
  usePaymentsClient,
  type ChargeRef,
  type ClientChargeRequest,
  type ClientPaymentsConfig,
} from "../index";

import { CLIENT_BASE_URL, createClientStoryStore, type ClientStorySpec } from "./client-store";

/**
 * THE HEADLESS CLIENT — `createPaymentsClient` + `PaymentsProvider` + the
 * three hooks, driving a real `mountPayments` charge surface in the page
 * (`client-store.ts`). The panel below is deliberately the story's OWN
 * pixels: the hooks ship none, and a host that wants its own design system
 * writes exactly this much — a provider at the top, `useCreateCharge` behind
 * a button, `useChargeStatus` behind whatever shows the outcome.
 *
 * `isSettled` is exercised where it is load-bearing: it is the published test
 * for "will waiting change the answer?", so it decides here — as it does in
 * `CheckoutPayment` — whether the status hook is given a charge to poll.
 */
const meta: Meta = {
  title: "Checkout/Headless client",
  parameters: {
    docs: {
      description: {
        component:
          "`PaymentsProvider` + `usePaymentsClient`/`useCreateCharge`/`useChargeStatus`, " +
          "with `createPaymentsClient` bound to a live `mountPayments` stack running in " +
          "the page — state and flow from the package, pixels from the host.",
      },
    },
  },
};
export default meta;

const STUB = { stub: true, publicKey: null } as const;

/**
 * The buyer identity the demo sends with each draft — CPF included: the story
 * chain declares the Brazilian CPF-required schema, and the MOUNT refuses a
 * charge without one (FUT-595). On this surface the host collects it.
 */
const BUYER: ClientChargeRequest["customer"] = {
  name: "Ana Compradora",
  email: "ana@exemplo.com",
  taxId: "52998224725",
};

/** One story = one store, with the context client bound to its in-page mount. */
function ClientScene({
  spec,
  children,
}: {
  spec?: ClientStorySpec;
  children: ReactNode;
}): JSX.Element {
  // Built once per mount (same rule as `host.tsx`): a fresh client identity on
  // every render would restart every consumer effect forever.
  const client = useMemo(
    () =>
      createPaymentsClient({
        baseUrl: CLIENT_BASE_URL,
        fetchImpl: createClientStoryStore(spec).fetchImpl,
      }),
    [],
  );
  return <PaymentsProvider client={client}>{children}</PaymentsProvider>;
}

/** The merchant's published config, read through the CONTEXT client. */
function ConfigLine(): JSX.Element {
  const client = usePaymentsClient();
  const [config, setConfig] = useState<ClientPaymentsConfig | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void client.getConfig().then((published) => {
      if (active) setConfig(published);
    });
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
      {config === undefined ? (
        "Lendo a configuração da loja…"
      ) : config === null ? (
        "Nenhum provedor conectado."
      ) : (
        <>
          Provedor ativo <code>{config.provider}</code>, tokenização{" "}
          <code>{config.tokenization}</code>.
        </>
      )}
    </p>
  );
}

/** The charge as the client sees it, and what `isSettled` says to do next. */
function ChargeFacts({ charge }: { charge: ClientChargeView }): JSX.Element {
  const settled = isSettled(charge.status);
  return (
    <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: 12, fontSize: 13 }}>
      <p style={{ margin: 0 }}>
        Cobrança <code>{charge.providerChargeId}</code> em <code>{charge.provider}</code> —
        status <strong>{charge.status}</strong>.
      </p>
      <p style={{ margin: "8px 0 0", opacity: 0.75 }}>
        {settled
          ? "Liquidada: isSettled manda parar de consultar — esperar não muda a resposta."
          : "Aguardando: o status é consultado a cada 2,5 s até liquidar."}
      </p>
      {charge.pix ? (
        <code style={{ display: "block", marginTop: 8, fontSize: 11, wordBreak: "break-all" }}>
          {charge.pix.qrText}
        </code>
      ) : null}
    </div>
  );
}

/**
 * The whole headless loop in one panel: create imperatively, then poll —
 * unless `isSettled` already says the answer is final, in which case the
 * status hook is handed `null` and never fires. A failed create renders the
 * error beside a "Tentar de novo" that calls the hook's own `reset()` — the
 * published way back to a clean slate.
 */
function ChargeLifecycle({
  label,
  request,
  fireOnMount = false,
}: {
  label: string;
  request: ClientChargeRequest;
  /** Send the draft once at mount, so a story can PIN the outcome at rest. */
  fireOnMount?: boolean;
}): JSX.Element {
  const { charge, loading, error, create, reset } = useCreateCharge();
  // Once, by guard rather than by deps: the request is a render literal, and
  // an identity-keyed effect would re-send the refused draft every render.
  const fired = useRef(false);
  useEffect(() => {
    if (!fireOnMount || fired.current) return;
    fired.current = true;
    void create(request);
  }, [create, fireOnMount, request]);
  const ref: ChargeRef | null =
    charge && !isSettled(charge.status)
      ? { provider: charge.provider, providerChargeId: charge.providerChargeId }
      : null;
  const { charge: live } = useChargeStatus(ref, { intervalMs: 2500 });
  const current = live ?? charge;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ConfigLine />
      <button
        type="button"
        disabled={loading}
        onClick={() => void create(request)}
        style={{ alignSelf: "flex-start", padding: "8px 16px", cursor: "pointer" }}
      >
        {loading ? "Enviando…" : label}
      </button>
      {error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ color: "#b91c1c", fontSize: 13, margin: 0 }}>{error.message}</p>
          <button type="button" onClick={reset} style={{ padding: "4px 10px", cursor: "pointer" }}>
            Tentar de novo
          </button>
        </div>
      ) : null}
      {current ? <ChargeFacts charge={current} /> : null}
    </div>
  );
}

/**
 * PIX: the created charge comes back PENDING with its copia-e-cola, so
 * `isSettled` is false and `useChargeStatus` keeps polling the mount — the
 * webhook-updates-server, browser-polls-server split the hook exists for.
 */
export const PixChargeLifecycle: StoryObj = {
  name: "Ciclo PIX — criar, consultar, parar quando liquidar",
  render: () => (
    <ClientScene>
      <ChargeLifecycle
        label="Gerar cobrança PIX"
        request={{ method: "PIX", customer: BUYER, orderRef: "pedido-0043" }}
      />
    </ClientScene>
  ),
};

/**
 * A declined card settles ON CREATE: `isSettled('DECLINED')` is true, so the
 * status hook is given nothing to poll and the panel says the answer is
 * final. This is the exact test `CheckoutPayment` applies before polling.
 */
export const DeclinedCardIsSettled: StoryObj = {
  name: "Cartão recusado — liquidado no criar, sem consulta",
  render: () => (
    <ClientScene spec={{ chain: [{ name: "aurora", methods: ["CARD"], declines: true, ...STUB }] }}>
      <ChargeLifecycle
        label="Cobrar no cartão"
        request={{
          method: "CARD",
          customer: BUYER,
          orderRef: "pedido-0043",
          card: { token: "tok_demo", holder: "ANA COMPRADORA" },
        }}
      />
    </ClientScene>
  ),
};

/**
 * `useCreateCharge`'s ERROR branch, pinned at rest: the draft is sent once on
 * mount WITHOUT the CPF the chain declares required, and the mount refuses it
 * — `error` set, `charge` still null, nothing handed to the status hook. The
 * "Tentar de novo" beside the message is the hook's own `reset()`: drive it
 * and the panel returns to the clean slate (the button would refuse again —
 * the draft is still missing its CPF, which is the point).
 *
 * PACKAGE FINDING, same family as the priorities story's: the message rendered
 * is the refusal's raw body — an English JSON envelope on a buyer-facing
 * surface — because `createPaymentsClient` throws the response body verbatim.
 * The story prints what the hook delivers; the sentence is the package's to
 * supply.
 */
export const ChargeRefusedAndReset: StoryObj = {
  name: "Criação recusada — error e reset do hook",
  render: () => (
    <ClientScene>
      <ChargeLifecycle
        label="Cobrar sem CPF (o mount recusa)"
        request={{ method: "PIX", customer: { name: "Ana Compradora" }, orderRef: "pedido-0043" }}
        fireOnMount
      />
    </ClientScene>
  ),
};
