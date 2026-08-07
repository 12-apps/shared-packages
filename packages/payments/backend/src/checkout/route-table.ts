import type { CheckoutRouteSpec } from './types';

/**
 * THE BUYER-CHECKOUT LAYOUT, as data (FUT-740) — a SECOND table beside
 * `http/route-table.ts`, sharing that mount's dispatcher and nothing else.
 *
 * Why not one table: see the module doc of `http/mount.ts`. The short version
 * is that merging them would let an unprefixed admin mount silently start
 * serving buyer checkout under the ADMIN's `requireAuth` after a version bump,
 * and that `config` already means two different things on the two surfaces.
 *
 * ## `principal` is a property of the ROW, not of the host callback
 *
 * This column is the one piece of the design that has to ship WITH it rather
 * than after. Folding six routes that each called their own auth helper into
 * one `requireAuth(request, intent)` invites a host to write
 * `switch (intent.kind)` — and a switch that defaults the wrong way makes
 * `GET /status` anonymous. That route SETTLES payables: it re-reads the charge
 * and applies the provider's answer through the host's confirmation path.
 *
 * So the mount, not the host, decides. `requireAuth` is invoked ONLY for
 * `BUYER` rows; a `PUBLIC` row never reaches it, and a host has no way to mark
 * a row public. The failure direction inverts: the worst a host mistake can do
 * is OVER-authenticate `/config`, which degrades a page load rather than a
 * settlement.
 *
 * `/config` is public for the reason the storefront's own route documented: the
 * buyer has not signed in when the checkout decides which methods to render,
 * and a provider name plus a PUBLIC browser key are page props, not secrets.
 */
export const CHECKOUT_ROUTES: readonly CheckoutRouteSpec[] = [
  {
    kind: 'getCheckoutConfig',
    method: 'GET',
    pattern: ['config'],
    principal: 'PUBLIC',
    payableScoped: false,
  },
  {
    kind: 'listInstruments',
    method: 'GET',
    pattern: ['cards'],
    principal: 'BUYER',
    payableScoped: false,
  },
  {
    kind: 'createCheckout',
    method: 'POST',
    pattern: [],
    principal: 'BUYER',
    payableScoped: false,
  },
  {
    kind: 'chargeInstrument',
    method: 'POST',
    pattern: ['charge'],
    principal: 'BUYER',
    payableScoped: true,
  },
  {
    kind: 'getStatus',
    method: 'GET',
    pattern: ['status'],
    principal: 'BUYER',
    payableScoped: true,
  },
  {
    kind: 'refreshBrowserKey',
    method: 'POST',
    pattern: ['refresh-key'],
    principal: 'BUYER',
    payableScoped: true,
  },
];
