/**
 * The `createPaymentFlows` vocabulary (FUT-741).
 *
 * `@12-apps/payments-frontend` exported a FLAT list — components, headless
 * hooks and fetch clients — and every host composed them by hand: six named
 * imports, a local slot table, a local fetch client, and its own answer to
 * "can this store charge?". Three hosts wrote that glue; the FUT-740 review
 * found its criticals in exactly the seam that glue spans.
 *
 * So there is now an easy path: call this ONCE at module scope, mount what
 * comes back. The flat exports stay — they are the escape hatch, and the
 * headless story proves they still work.
 *
 * ## Zero provider names
 *
 * Nothing in this file, or in anything it returns, names a vendor. Every branch
 * is decided by the server-published `tokenization` / `methods` /
 * `customerSchema`. The only place a name exists at all is as an OPAQUE KEY:
 * `chain[].provider`, looked up in the tokenizer registry and used verbatim as
 * a `tokensByProvider` key. A host never types one.
 */
import type { CheckoutPaymentList } from "../components/checkout/list/types";
import type { BackActionEmphasis } from "../components/checkout/payment-status-parts";
import type { ComponentType, ReactNode } from "react";

import type { SavedCard } from "../card";
import type { CheckoutComponents } from "../components/checkout/ui";
import type { CheckoutCartView } from "../components/checkout/checkout-flow";
import type {
  BuyerContact,
  BuyerInfo,
  ChargeCardInput,
  ChargeOutcome,
  CheckoutOrder,
  CheckoutProviderConfig,
  SettlementCheckout,
  CreateOrderRequest,
  CreateOrderResult,
  OrderStatus,
} from "../components/checkout/types";
import type {
  CheckoutTransportBinding,
  VaultedCardDisplay,
} from "../components/checkout/transport";
import type { useCheckoutController } from "../components/checkout/use-checkout-controller";
import type { Result } from "../result";

import type { CheckoutCopyFE } from "./copy";

/** The host's remedy on the unavailable screen, and its veto over a live chain. */
export interface CheckoutAvailability {
  /**
   * The host's own answer to "may this store take money right now?".
   *
   * OR'd with the chain, never swapped for it. A store with a working provider
   * chain that has switched online payments OFF is invisible to `/config` —
   * the chain is non-empty and the checkout would happily offer a picker it
   * will not honour. That fact lives in the host, so the host votes.
   */
  payable: boolean;
  /** What the buyer can do instead, when there is something. */
  remedy?: { label: string; onSelect(): void };
}

/** Everything the flow needs FROM its host that is not a money rule. */
export interface CheckoutPorts {
  /** Raise the payable + first charge. Same contract as today's `createOrder`. */
  createPayable(input: CreateOrderRequest): Promise<CreateOrderResult>;
  /** Persist the buyer's contact under the "salvar meus dados" consent. */
  saveBuyerContact?(contact: BuyerContact): void;
  /** Leave checkout for the host's menu/catalog. */
  exitToCatalog(): void;
  /** The payable settled PAID — the host re-reads whatever the server emptied. */
  onPaid?(): void;
  /**
   * Hosted handover / 3-DS. Defaults to `window.location.assign`. A port
   * because the destination is ANOTHER ORIGIN — never the host's router — and
   * some hosts must log or confirm the departure.
   */
  navigate?(url: string): void;
  /**
   * Apple Pay merchant validation (FUT-472): exchange the session's
   * `validationURL` for an Apple merchant session, SERVER-SIDE — the merchant
   * identity certificate must never reach a browser. Optional; without it the
   * Apple Pay sheet cannot start and the card form remains the way to pay.
   */
  validateApplePayMerchant?(validationURL: string): Promise<unknown>;
  /** The remedy shown on the no-provider screen, AND the host's veto. */
  useAvailability?(): CheckoutAvailability;
}

/** The host's half of the paid screen — see {@link PaymentFlowsConfig.confirmation}. */
export interface CheckoutConfirmation {
  extra?: ReactNode;
  hero?: ReactNode;
  footer?: ReactNode;
  backActionEmphasis?: BackActionEmphasis;
}

/** What `createPaymentFlows` is configured with. */
export interface PaymentFlowsConfig {
  /** Where the `createPaymentFlowsBE` mount lives. Default `/api/checkout`. */
  transport?: CheckoutTransportBinding;

  /**
   * The store being paid. A HOOK because the host's router owns it: taking a
   * value here would freeze the slug of whichever store loaded first onto every
   * checkout the page ever renders.
   */
  useScope?(): { tenantSlug?: string };
  /** The cart, reduced to display facts. Never money math. */
  useCart(): CheckoutCartView;
  /**
   * The buyer's saved details, whether a document is already on file, and
   * WHICH one (`taxIdKindOnFile`, `CheckoutFlowProps.taxIdKindOnFile`): without
   * the kind, a saved CNPJ reads "CPF ✓" on the payer line.
   */
  useBuyerDefaults?(): {
    buyer?: BuyerInfo;
    taxIdOnFile?: boolean;
    taxIdKindOnFile?: "CPF" | "CNPJ" | null;
    pending?: boolean;
  };
  /** Present ⇒ this checkout settles a settlement rather than the cart. */
  useSettlement?(): SettlementCheckout | null;
  /**
   * The Pagamento step, which is ONE list (FUT-3591) —
   * `CheckoutFlowProps.paymentList`, read through a HOOK because the host's
   * door options follow its own state. REQUIRED to mount `Checkout`
   * (FUT-4028): there is no other Pagamento, and `Checkout` throws without
   * it. Optional only so a host that mounts just `screens` (a Pix pane, a card
   * pane) is not asked for a checkout it never draws.
   */
  usePaymentList?(): CheckoutPaymentList;
  /**
   * The store's provider answer, when the HOST already holds it (FUT-1241).
   *
   * `Checkout` fetches `/config` itself by default. A host that has read it
   * already — or that STATES an answer of its own for this lane, such as "no
   * online provider here, only the in-person rows" — returns it here, and the
   * factory fetches nothing: one read, and the host's answer is the one the list
   * draws. Return `undefined` to let the factory fetch. A HOOK, read every
   * render, because the host's answer follows its own state.
   *
   * Read by `Checkout` ONLY. `Provider`, the standalone `screens.*` and
   * `useCheckoutConfig` still fetch `/config` for themselves; "nothing is
   * fetched" holds for the one mount.
   */
  useProviderConfig?(): CheckoutConfigState | undefined;
  /**
   * Whether `Checkout` itself answers a store that cannot charge — the host's
   * veto, or an empty provider chain with no in-person row — with
   * `screens.PaymentsUnavailable` (FUT-1241). Default `true`.
   *
   * `false` draws the one list exactly as the host handed it, which is what
   * `<CheckoutFlow>` does: a host that already decides that screen ABOVE the
   * flow (its own route gate, its own "not paid online" answer) keeps that
   * decision its own, and a lane moved onto the factory shows no screen the
   * hand mount never showed. `createCheckoutPropsBinding` sets it.
   */
  refusesUnchargeableStore?: boolean;

  /** Design-system slots, filled ONCE instead of per screen. */
  components?: Partial<CheckoutComponents>;

  /**
   * The host's domain, as ports. Nothing here is a money rule.
   *
   * Fixed when the flow is built. A host whose ports close over render state
   * (its router, its cart, its order port) passes {@link usePorts} instead, and
   * may then leave this out; one of the two is required.
   */
  ports?: CheckoutPorts;
  /**
   * The ports for THIS render (FUT-1241) — read in a component body, so the
   * functions may close over the host's current state. Wins over `ports`. The
   * factory keeps the identities it hands the flow stable across renders and
   * calls whatever this returned last, so a host never writes a ref of its own.
   * Whether each optional port is PRESENT must not change between renders
   * (`useAvailability` is a hook).
   */
  usePorts?(): CheckoutPorts;

  polling?: { intervalMs?: number; cardMaxPolls?: number };
  // NO `tokenization: { mintTimeoutMs }` here yet, deliberately. It was
  // declared and never threaded to the mint path, so a host could set a
  // deadline, believe the chain honoured it, and get none — config that lies is
  // worse than config that is absent. Landing it for real needs the answer to
  // "what happens WHEN it fires": a timed-out mint must decide whether the walk
  // advances to the next entry or the whole charge refuses, and that is a money
  // rule (FUT-563), not a wire-up.
  /**
   * Every buyer-facing sentence the factory's own screens render.
   *
   * REQUIRED, and not partial. It used to be `Partial<…>` over a pt-BR default
   * spread in at `create-payment-flows.tsx`, and that default was one product's
   * RESTAURANT vocabulary — "Pagamento com o garçom", "Chame o garçom para
   * fechar a conta na mesa", "Ver cardápio" — reaching every adopter that said
   * nothing. A host selling insurance got a waiter.
   *
   * That is the failure a default cannot warn about: saying nothing is exactly
   * how a host adopts another product's voice, and nothing fails. Required
   * makes a new host answer once, at the one call site that knows the answer.
   */
  copy: CheckoutCopyFE;
  /**
   * The copy for THIS render (FUT-1241), for a host whose words follow its own
   * state — the buyer's language, the lane's exit word. Wins over `copy` on
   * every screen the factory draws, AND on the transport's own failure
   * sentences: the screens' client is rebuilt from this copy's `transport`
   * words whenever they change (a `transport.copy` of the host's still wins).
   * `copy` stays required: it is what `flows.client` — built once, with the
   * flow — speaks.
   */
  useCopy?(): CheckoutCopyFE;
  /**
   * Host content under the paid receipt (the storefront's PWA install invite),
   * the host's own illustration in place of the paid icon (`hero`), content
   * AFTER the confirmation's actions (`footer`), and whether the way out leads
   * the paid screen (`backActionEmphasis`) — `CheckoutFlowProps`'
   * `confirmationExtra`/`Hero`/`Footer` and `backActionEmphasis`, so a host on
   * the factory composes the same confirmation as one mounting the flow.
   */
  confirmation?: CheckoutConfirmation;
  /**
   * The confirmation for THIS render (FUT-1241): a host whose receipt follows
   * the pedido — a celebration hero shown only when there is one, a way out
   * whose emphasis follows the lane — returns it here. Wins over
   * `confirmation`.
   */
  useConfirmation?(): CheckoutConfirmation | undefined;
  /**
   * Warnings the host reports (Sentry). Default SILENT — never `console`: a
   * library that writes to a buyer's console tells them nothing and tells the
   * host nothing either.
   */
  onWarning?(line: string, context?: Record<string, unknown>): void;
}

/** The flow controller a hand-composing host drives itself. */
export type CheckoutController = ReturnType<typeof useCheckoutController>;

/** The pre-bound fetch clients — same shapes as the free functions. */
export interface BoundCheckoutClient {
  getConfig(tenantSlug: string): Promise<Result<CheckoutProviderConfig>>;
  getStatus(ref: string): Promise<Result<OrderStatus>>;
  charge(input: ChargeCardInput): Promise<Result<ChargeOutcome>>;
  listInstruments(tenantSlug?: string): Promise<SavedCard[]>;
  refreshBrowserKey(input: { orderId: string }): Promise<Result<{ publicKey: string | null }>>;
}

/** The screens a host may nest itself. Every one works standalone. */
export interface CheckoutScreens {
  CardEntry: ComponentType<{ payable: CheckoutOrder; onResolved(s: OrderStatus): void }>;
  PixPayment: ComponentType<{ payable: CheckoutOrder; onResolved(s: OrderStatus): void }>;
  HostedHandoff: ComponentType<{ url: string; payable: CheckoutOrder; onCancel?(): void }>;
  HostedReturn: ComponentType<{ onResolved(s: OrderStatus): void }>;
  PaymentStatus: ComponentType<{ status: OrderStatus | null; payable?: CheckoutOrder | null }>;
  PaymentsUnavailable: ComponentType<Record<string, never>>;
  SavedCards: ComponentType<{ selection: string; onSelect(id: string): void }>;
  EmptyCart: ComponentType<Record<string, never>>;
  /**
   * Put a card on file OUTSIDE a purchase (FUT-183, over FUT-478's
   * `/cards/begin` + `/cards/complete`). `onSaved` fires with display metadata
   * only — the vault token never reaches the browser.
   */
  AddCard: ComponentType<{ onSaved?(display: VaultedCardDisplay): void }>;
  /**
   * The buyer's saved cards, plus the door into {@link CheckoutScreens.AddCard}.
   * Read-only beyond that: there is no buyer-side delete (PagBank publishes no
   * token-delete endpoint — see `flows/screens-vault.tsx`).
   */
  ManageCards: ComponentType<Record<string, never>>;
}

/** The fetched store protocol, plus whether it is still in flight. */
export interface CheckoutConfigState {
  config: CheckoutProviderConfig | null;
  pending: boolean;
}

/** What `createPaymentFlows` returns. */
export interface PaymentFlows {
  /** THE mount: a complete buyer checkout in one line. */
  Checkout: ComponentType<{
    settlement?: SettlementCheckout | null;
    /** `CheckoutFlowProps.parkHostedOrders` — default `true`, the host's one checkout. */
    parkHostedOrders?: boolean;
    /** Slots for THIS mount, layered over the config's `components`. */
    components?: Partial<CheckoutComponents>;
  }>;
  /** Slots + transport + scope + the fetched config, for a nesting host. */
  Provider: ComponentType<{ children: ReactNode; config?: CheckoutProviderConfig | null }>;
  screens: CheckoutScreens;
  /** The flow controller, pre-bound to the ports — the easy path is not the only path. */
  useCheckout(): CheckoutController;
  useCheckoutConfig(): CheckoutConfigState;
  client: BoundCheckoutClient;
}
