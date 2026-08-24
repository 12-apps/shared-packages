/**
 * The two payments WEB manifests, adopted through the wiring consumer.
 *
 * `@12-apps/payments-frontend` ships two of them — the owner's provider
 * settings and the shopper's checkout — and this app bound NEITHER. It used
 * every component behind them, across twenty-two pages, by importing the
 * barrel directly: the settings page reaches for the `PaymentProviderSettings`
 * component rather than `createWebPaymentsSettings`, and every checkout page
 * calls `createPaymentFlows` itself.
 *
 * So the most heavily-used package in this app was also the one whose
 * declaration nothing answered, and nothing was red — `assemble()` reports on
 * the packages a host ADOPTED, so a manifest nobody adopts is not an
 * unanswered capability, it is a package the report never hears about.
 *
 * ## Why ONE adoption and not twenty-two
 *
 * The consumer keys its surfaces by PACKAGE NAME, and that is right: a host
 * mounts one settings screen and one checkout. This harness is the other thing
 * — a matrix of twenty-two host WIRINGS of the same surface, each with
 * different ports, a different provider chain, a different cart. That matrix
 * is a test fixture, not a host's architecture, and collapsing it into one
 * adoption would delete the only place those variations are exercised.
 *
 * So the adoption below is the CANONICAL host — the answers this app would
 * ship with — and the scenario pages keep building their own worlds. What the
 * adoption adds is the half the direct calls never had: both manifests bound,
 * their `areas` collected, and both packages in the report.
 *
 * The configs are not restated here. `harnessFlowsConfig` and
 * `createAdminStore` are the same builders the scenario pages use, so this
 * host answers each question once and the adoption cannot drift from what is
 * under test.
 *
 * ## The areas, which a direct call leaves on the floor
 *
 * The settings screen declares an admin route AND a nav row; the checkout
 * declares a client route with NO nav row, because a checkout is reached from
 * a cart and a menu entry pointing at it is a link to an empty basket. Neither
 * fact reaches a host that calls the factory itself.
 */
import {
  paymentsCheckoutFrontendManifest,
  paymentsFrontendManifest,
} from '@12-apps/payments-frontend/manifest';
import {
  paymentsCheckoutFrontendWebManifest,
  paymentsFrontendWebManifest,
} from '@12-apps/payments-frontend/manifest/web';

import { webWiringHost } from '../wiring-web';
import { aurora, boreal } from './admin-adapter';
import { createAdminStore } from './admin-store';
import { harnessFlowsConfig } from './host';

/**
 * The canonical admin world, seeded in the background.
 *
 * Two of the harness's fictional providers, built by the same helpers the
 * scenario pages use — a catalog with something in it, so the screen has rows
 * to render rather than an empty state that would pass while proving less.
 *
 * `ready` is the seed; the CLIENT is synchronous and is what the surface binds,
 * so the adoption does not wait. A page renders the screen and the screen reads
 * through the client, which is exactly the order a real host boots in.
 */
const admin = createAdminStore({
  providers: [aurora(), boreal()],
  // Its own base, like every scenario world: `baseUrl` is the client's origin
  // AND the localStorage ack scope, so two worlds sharing one would answer each
  // other's reads. There is no default — an omitted one builds `undefined/…`
  // URLs that 404, which surfaces as the screen's generic error alert rather
  // than as anything naming the cause.
  baseUrl: '/api/harness/payments/adopted',
});

/** Seeded before the specs drive the screen — awaited by the page, not here. */
export const adminReady = admin.ready;

/**
 * A manifest object with no `AnyWebManifest` import.
 *
 * `@12-apps/payments-*` may not import the wiring contract at all
 * (`payments/no-host-imports`), so its manifests ship as untyped pure data and
 * the compliance run lives on the contract's side. The cast is that rule
 * surfacing at the adoption, not a type being silenced: the shape is checked
 * by `assemble()` at runtime, which is the check that matters here.
 */
type SharedManifestShape = Parameters<typeof webWiringHost.adoptWeb>[0]['manifest'];
type WebManifestShape = Parameters<typeof webWiringHost.adoptWeb>[0]['web'];

const settings = webWiringHost.adoptWeb({
  manifest: paymentsFrontendManifest as unknown as SharedManifestShape,
  web: paymentsFrontendWebManifest as unknown as WebManifestShape,
  bindings: { surface: { config: { client: admin.world.client } } },
});

const checkout = webWiringHost.adoptWeb({
  manifest: paymentsCheckoutFrontendManifest as unknown as SharedManifestShape,
  web: paymentsCheckoutFrontendWebManifest as unknown as WebManifestShape,
  bindings: { surface: { config: harnessFlowsConfig().config } },
});

/** The owner's provider-settings page, bound to the canonical client. */
export const settingsSurface = settings.surface as { page: React.ComponentType };

/** The shopper's checkout, bound to the canonical cart, scope and ports. */
export const checkoutSurface = checkout.surface as { Checkout: React.ComponentType };
