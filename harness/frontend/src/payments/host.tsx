/**
 * The HOST half of a harness page (FUT-743): the ports, the cart and the slot
 * table a real application supplies, written once so each page is only its own
 * store.
 *
 * Nothing here is part of the package. It is deliberately the same amount of
 * glue an adopter writes — `apps/client/src/pages/checkout/index.tsx` in
 * the origin host is the reference — which is also what makes these pages a check on
 * whether that amount is reasonable.
 */
import {
  createPaymentFlows,
  type BuyerField,
  type BuyerInfo,
  type CheckoutAvailability,
  type CheckoutCartView,
  type ComandaCheckout,
  type CreateOrderRequest,
  type CreateOrderResult,
  type PaymentFlows,
  type PaymentFlowsConfig,
} from '@12-apps/payments-frontend';
import { useMemo, type JSX, type ReactNode } from 'react';

import { brlLabel } from './adapter';
import { HARNESS_CHECKOUT_COPY } from './checkout-copy';
import { createHarnessStore, type HarnessStoreSpec, type HarnessWorld } from './store';

/** The envelope every checkout route answers with. */
interface Envelope {
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
  field?: BuyerField | null;
}

/** The host's own view of a raised payable. The library never reads it. */
interface PayableView {
  invoice: string;
  total: number;
  totalLabel: string;
  pix?: { copyPaste: string; expiresAt: string };
  hostedCheckoutUrl?: string;
}

/** The mount's structured refusal, in the shape the flow's ports speak. */
function refusal(body: Envelope | null): CreateOrderResult {
  return {
    ok: false,
    error: {
      code: body?.code ?? 'UNKNOWN',
      message: body?.error ?? 'Não foi possível continuar.',
      field: body?.field ?? null,
    },
  };
}

/** The view, as the checkout's payable. */
function payableOf(view: PayableView, method: CreateOrderRequest['method']) {
  return {
    orderId: view.invoice,
    status: 'AWAITING_PAYMENT' as const,
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

/** What the host reads back out of `POST /` and turns into a payable view. */
async function raisePayable(
  world: HarnessWorld,
  input: CreateOrderRequest,
): Promise<CreateOrderResult> {
  // The buyer travels WITH the request that raises the payable. There is no
  // other door: the payable has no column for a CPF, which is FUT-740's third
  // critical stated as a host contract.
  const response = await world.createPayable({ method: input.method, buyer: input.buyer });
  const body = (await response.json().catch(() => null)) as Envelope | null;
  if (!response.ok || !body?.data) return refusal(body);
  return { ok: true, data: payableOf(body.data as unknown as PayableView, input.method) };
}

/** Everything a page may vary about the HOST, as opposed to the store. */
export interface HarnessHost {
  cart?: Partial<CheckoutCartView>;
  comanda?: ComandaCheckout | null;
  /** The host's veto + remedy. Omitted ⇒ payable, no remedy. */
  availability?: CheckoutAvailability;
  /** What the buyer form opens pre-filled with. */
  buyer?: BuyerInfo;
  /** The store already holds this buyer's CPF ⇒ Dados is skipped (FUT-465). */
  taxIdOnFile?: boolean;
  components?: PaymentFlowsConfig['components'];
  confirmationExtra?: ReactNode;
  tenantSlug?: string;
  /**
   * What the `/config` read does, for the two states a live mount cannot be
   * asked to produce: `pending` never answers, `failing` answers 500 (which
   * must fail OPEN for the UI and CLOSED for the money). Only `/config` is
   * affected; everything else still reaches the real mount.
   */
  configRead?: 'ok' | 'pending' | 'failing';
  /**
   * Apple Pay merchant validation (FUT-472) — the port a real host implements
   * server-side. The harness answers a fixed session; a page without it
   * exercises the abort path.
   */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
}

/** Wrap the mount's fetch so `/config` can stall or refuse. */
function withConfigRead(inner: typeof fetch, mode: HarnessHost['configRead']): typeof fetch {
  if (!mode || mode === 'ok') return inner;
  const shim = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!String(input).includes('/config')) return inner(input, init);
    if (mode === 'failing') {
      return new Response(JSON.stringify({ error: 'indisponível', code: 'SERVER_ERROR' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Never settles: the page is about what the screen shows WHILE it waits.
    return new Promise<Response>(() => undefined);
  };
  return shim as typeof fetch;
}

/** The cart most pages are set in: two items, R$ 75,00. */
function cartOf(amountCents: number, overrides?: Partial<CheckoutCartView>): CheckoutCartView {
  return { empty: false, totalLabel: brlLabel(amountCents), totalItems: 2, ...overrides };
}

/**
 * Build a factory for one page: a real mount behind the transport, and a real
 * host in front of it.
 */
export function harnessFlowsConfig(
  spec: HarnessStoreSpec = {},
  host: HarnessHost = {},
): { config: Parameters<typeof createPaymentFlows>[0]; world: HarnessWorld } {
  const world = createHarnessStore(spec);
  const amountCents = spec.amountCents ?? 7500;
  const config: Parameters<typeof createPaymentFlows>[0] = {
    // The DEFAULT base url is left in place on purpose: `/api/checkout`,
    // verbatim, is what the shipped client posts and what the mount's shim
    // answers. A page that re-prefixed it would stop testing that.
    transport: { fetchImpl: withConfigRead(world.fetchImpl, host.configRead) },
    useScope: () => ({ tenantSlug: host.tenantSlug ?? 'loja-harness' }),
    useCart: () => cartOf(amountCents, host.cart),
    useBuyerDefaults: () => ({ buyer: host.buyer, taxIdOnFile: host.taxIdOnFile ?? false }),
    useComanda: () => host.comanda ?? null,
    components: host.components,
    // Required now, and stated by THIS host in its own words. It used to be
    // omitted, which meant rendering the package's pt-BR default — another
    // product's restaurant vocabulary — while claiming to be an independent
    // consumer. See `./checkout-copy`.
    copy: HARNESS_CHECKOUT_COPY,
    confirmation: host.confirmationExtra ? { extra: host.confirmationExtra } : undefined,
    ports: {
      createPayable: (input) => raisePayable(world, input),
      saveBuyerContact: () => undefined,
      exitToCatalog: () => undefined,
      // RECORDED rather than followed. A page that really navigated would leave
      // the harness, and the whole point of the handover screens is that the
      // departure is observable at all — so the probe shows where the buyer
      // would have gone, which no `window.location.assign` ever could.
      navigate: (url) => world.recordNavigation(url),
      validateApplePayMerchant: host.validateApplePayMerchant,
      useAvailability: () => host.availability ?? { payable: true },
    },
  };
  return { config, world };
}

/**
 * The same thing, BUILT — what twenty-two scenario pages call.
 *
 * Split from the config above so the one canonical adoption
 * (`./wiring.ts`) and these many worlds state the host's answers ONCE. A
 * second copy of this config for the adoption would be a second definition of
 * what this host's checkout is, drifting from the one under test.
 */
export function harnessFlows(
  spec: HarnessStoreSpec = {},
  host: HarnessHost = {},
): { flows: PaymentFlows; world: HarnessWorld } {
  const { config, world } = harnessFlowsConfig(spec, host);
  return { flows: createPaymentFlows(config), world };
}

/**
 * A page body with its own factory, built once per mount.
 *
 * Render-prop rather than props-in-props so a page can reach BOTH the screens
 * and the world — every page renders the wire probe, which is the whole reason
 * the mount is real.
 */
export function HarnessFlow({
  spec,
  host,
  children,
}: {
  spec?: HarnessStoreSpec;
  host?: HarnessHost;
  children: (flows: PaymentFlows, world: HarnessWorld) => ReactNode;
}): JSX.Element {
  // Built once per mount. A factory rebuilt on every render would hand every
  // screen a new transport identity and restart their effects forever.
  const { flows, world } = useMemo(() => harnessFlows(spec, host), []);
  return <>{children(flows, world)}</>;
}
