/**
 * The HOST half of a story (FUT-742): the ports, the cart and the slot table a
 * real application supplies, written once so each story is only its own store.
 *
 * Nothing here is part of the package. It is deliberately the same amount of
 * glue an adopter writes — which is also what makes the stories a check on
 * whether that amount is reasonable.
 */
import { useMemo, type JSX, type ReactNode } from "react";

import { createPaymentFlows } from "../flows/create-payment-flows";
import type { CheckoutAvailability, PaymentFlows, PaymentFlowsConfig } from "../flows/types";
import type {
  BuyerField,
  BuyerInfo,
  CheckoutCartView,
  SettlementCheckout,
  CreateOrderRequest,
  CreateOrderResult,
} from "../index";

import { brlLabel, createStoryStore, type StorySpec, type StoryWorld } from "./store";

/** The envelope every checkout route answers with. */
interface Envelope {
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
  field?: BuyerField | null;
}

/** What the host reads back out of `POST /` and turns into a payable view. */
export async function raisePayable(
  world: StoryWorld,
  input: CreateOrderRequest,
): Promise<CreateOrderResult> {
  // The buyer travels WITH the request that raises the payable. There is no
  // other door: the payable has no column for a CPF, which is the third
  // FUT-740 critical stated as a host contract.
  const response = await world.createPayable({ method: input.method, buyer: input.buyer });
  const body = (await response.json().catch(() => null)) as Envelope | null;
  if (!response.ok || !body?.data) return refusal(body);
  return { ok: true, data: payableOf(body.data as unknown as PayableView, input.method) };
}

/** The mount's structured refusal, in the shape the flow's ports speak. */
function refusal(body: Envelope | null): CreateOrderResult {
  return {
    ok: false,
    error: {
      code: body?.code ?? "UNKNOWN",
      message: body?.error ?? "Não foi possível continuar.",
      field: body?.field ?? null,
    },
  };
}

/** The host's own view of a raised payable. The library never reads it. */
interface PayableView {
  invoice: string;
  total: number;
  totalLabel: string;
  pix?: { copyPaste: string; expiresAt: string };
  hostedCheckoutUrl?: string;
}

/** The view, as the checkout's payable. */
function payableOf(view: PayableView, method: CreateOrderRequest["method"]) {
  return {
    orderId: view.invoice,
    status: "AWAITING_PAYMENT" as const,
    method,
    totalCents: view.total,
    subtotalCents: view.total,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: view.totalLabel,
    ...(view.pix ? { pix: view.pix } : {}),
    ...(view.hostedCheckoutUrl ? { hostedCheckoutUrl: view.hostedCheckoutUrl } : {}),
  };
}

/** Everything a story may vary about the HOST, as opposed to the store. */
export interface StoryHost {
  cart?: Partial<CheckoutCartView>;
  settlement?: SettlementCheckout | null;
  /** The host's veto + remedy. Omitted ⇒ payable, no remedy. */
  availability?: CheckoutAvailability;
  /** What the buyer form opens pre-filled with. */
  buyer?: BuyerInfo;
  /** The store already holds this buyer's CPF ⇒ Dados is skipped (FUT-465). */
  taxIdOnFile?: boolean;
  components?: PaymentFlowsConfig["components"];
  /** Overrides for the factory-owned sentences (`DEFAULT_CHECKOUT_COPY_FE`). */
  copy?: PaymentFlowsConfig["copy"];
  /** Where a hosted handover would have taken the buyer. Recorded, not followed. */
  onNavigate?: (url: string) => void;
  confirmationExtra?: ReactNode;
  tenantSlug?: string;
  /**
   * What the `/config` read does, for the two states a live mount cannot be
   * asked to produce:
   *
   *   - `pending` — never answers, so the flow renders while it waits;
   *   - `failing` — answers 500, which must fail OPEN for the UI (both tiles)
   *     and CLOSED for the money (no mock permission is invented).
   *
   * Only `/config` is affected; everything else still reaches the real mount.
   */
  configRead?: "ok" | "pending" | "failing";
}

/**
 * Wrap the mount's fetch so `/config` can stall or refuse. Exported for the
 * legacy surface's stories: `CheckoutPayment`'s own config read speaks a
 * different wire (`client-store.ts`) but stalls the same way.
 */
export function withConfigRead(inner: typeof fetch, mode: StoryHost["configRead"]): typeof fetch {
  if (!mode || mode === "ok") return inner;
  const shim = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!String(input).includes("/config")) return inner(input, init);
    if (mode === "failing") {
      return new Response(JSON.stringify({ error: "indisponível", code: "SERVER_ERROR" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    // Never settles: the story is about what the screen shows WHILE it waits.
    return new Promise<Response>(() => undefined);
  };
  return shim as typeof fetch;
}

/** The cart most stories are set in: two items, R$ 75,00. */
function cartOf(amountCents: number, overrides?: Partial<CheckoutCartView>): CheckoutCartView {
  return {
    empty: false,
    totalLabel: brlLabel(amountCents),
    totalItems: 2,
    ...overrides,
  };
}

/**
 * Build a factory for one story: a real mount behind the transport, and a real
 * host in front of it.
 */
export function storyFlows(spec: StorySpec = {}, host: StoryHost = {}): {
  flows: PaymentFlows;
  world: StoryWorld;
} {
  const world = createStoryStore(spec);
  const amountCents = spec.amountCents ?? 7500;
  const flows = createPaymentFlows({
    // The DEFAULT base url is left in place on purpose: `/api/checkout`,
    // verbatim, is what the shipped client posts and what the mount's shim
    // below answers. A story that re-prefixed it would stop testing that.
    transport: { fetchImpl: withConfigRead(world.fetchImpl, host.configRead) },
    useScope: () => ({ tenantSlug: host.tenantSlug ?? "loja-1" }),
    useCart: () => cartOf(amountCents, host.cart),
    useBuyerDefaults: () => ({ buyer: host.buyer, taxIdOnFile: host.taxIdOnFile ?? false }),
    useSettlement: () => host.settlement ?? null,
    components: host.components,
    copy: host.copy,
    confirmation: host.confirmationExtra ? { extra: host.confirmationExtra } : undefined,
    ports: {
      createPayable: (input) => raisePayable(world, input),
      saveBuyerContact: () => undefined,
      exitToCatalog: () => undefined,
      // Recorded rather than followed: a story that really navigated would
      // leave Storybook, and the point of `HostedHandoff` is that the departure
      // is observable at all.
      navigate: (url) => host.onNavigate?.(url),
      useAvailability: () => host.availability ?? { payable: true },
    },
  });
  return { flows, world };
}

/** A story that needs its own factory instance per render (state isolation). */
function useStoryFlows(
  spec: StorySpec = {},
  host: StoryHost = {},
): { flows: PaymentFlows; world: StoryWorld } {
  // Built once per mount. A factory rebuilt on every render would hand every
  // screen a new transport identity and restart their effects forever.
  return useMemo(() => storyFlows(spec, host), []);
}

/**
 * A story body with its own factory, built once per mount.
 *
 * Render-prop rather than props-in-props so a story can reach BOTH the screens
 * and the world — several of them assert on what the provider actually
 * received, which is the whole reason the mount is real.
 */
export function StoryFlow({
  spec,
  host,
  children,
}: {
  spec?: StorySpec;
  host?: StoryHost;
  children: (flows: PaymentFlows, world: StoryWorld) => ReactNode;
}): JSX.Element {
  const { flows, world } = useStoryFlows(spec, host);
  return <>{children(flows, world)}</>;
}
