/**
 * `@12-apps/payments-frontend/manifest/web` — the web capabilities.
 *
 * UNTYPED pure data — see `./index` for why this package may not import the
 * wiring contract, and where its compliance run lives instead.
 *
 * Each `surface.create` IS the package's existing factory, unchanged:
 * `createWebPaymentsSettings` for the owner's screen and `createPaymentFlows`
 * for the buyer's. Both return component TYPES, so the consumer's binder
 * builds them ONCE per adoption — which is the memoisation rule every hand
 * wiring carries as a comment today, and which matters more here than
 * anywhere: rebuilding `createPaymentFlows` per render would rebuild the
 * checkout transport under a shopper mid-payment.
 *
 * ## WHAT STAYS SURFACE CONFIG, deliberately
 *
 * The design-system slots (`CheckoutComponentsProvider`'s button, input,
 * stepper, alert…) and `CheckoutHostPorts` are the config a host hands
 * `createPaymentFlows`, and they stay exactly that. They are not capabilities
 * to declare: a slot table is one host's design system, and a port is one
 * host's cart, scope and settlement. The contract's `surface` capability is
 * precisely the shape that carries them — `create(config)` — so declaring
 * the factory declares the whole seam without naming a single host's answer.
 *
 * Likewise the COPY packs. Every sentence both surfaces render is a required
 * prop with no package default (FUT-760), because a default would be one
 * product's Portuguese compiled into every other product's checkout. They
 * stay per-render props rather than factory config for the reason the estate
 * separates the two: copy follows the READER's locale, and freezing it at
 * bind time pins the surface to whichever language was in effect when the
 * host built it.
 *
 * ## THE AREAS
 *
 * Suggestions, structurally — the host composes, reorders, relabels and
 * vetoes at its single call site. Each carries one honest fact:
 *
 * - the settings screen belongs in the ADMIN area, as a routed page with a
 *   nav row (`testId: 'payments'` — the host maps its own icon and word);
 * - the checkout belongs in the CLIENT area as a route with NO nav row. A
 *   checkout is reached from a cart, never from a menu, and a nav entry
 *   pointing at it is a link to an empty basket.
 *
 * No permission gates and no plan features on either: both are host
 * vocabulary (this package depends on no RBAC and knows no plan catalog),
 * and a package that guessed would be wrong for every host but the first.
 */

import { createPaymentFlows } from '../flows/create-payment-flows';
import { createWebPaymentsSettings } from '../flows/create-payments-settings';

/** The OWNER's provider-settings surface — one routed page in the admin SPA. */
export const paymentsFrontendWebManifest = {
  name: '@12-apps/payments-frontend',
  surface: { create: createWebPaymentsSettings },
  areas: [
    {
      area: 'admin',
      routes: [{ path: 'config/payments', screen: 'page' }],
      nav: [{ testId: 'payments', path: 'config/payments' }],
    },
  ],
} as const;

/**
 * The SHOPPER's checkout surface. `screen: 'Checkout'` is the one-line mount
 * `createPaymentFlows` returns; everything under `screens` is for a host
 * composing its own pixels and is deliberately not routed here.
 */
export const paymentsCheckoutFrontendWebManifest = {
  name: '@12-apps/payments-checkout-ui',
  surface: { create: createPaymentFlows },
  areas: [
    {
      area: 'client',
      routes: [{ path: 'checkout', screen: 'Checkout' }],
    },
  ],
} as const;
