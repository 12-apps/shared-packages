/**
 * `createWebEntitlements(config)` — the frontend half of the surface, as one
 * factory over config.
 *
 * What the host keeps is exactly what it knows and the package cannot: where
 * the API half is mounted (`apiBase`), whether THIS caller holds
 * `plan:request` (a resolved RBAC answer), where each tenant switch lives in
 * the host's own routes, and which link primitive its router uses. Everything
 * else — the plan screen, the pricing cards, the page lock, the upgrade
 * prompt, the wire parsing — is the package's.
 *
 * Money boundary: the surface RENDERS pricing the API half already formatted
 * from host billing data. It never computes a price and never mounts a
 * checkout — the one write it can perform files a lead for a human.
 */
import type { ComponentType, JSX } from 'react';

import type { EntitlementsLinkProps, ResolvedWebConfig, WebEntitlementsConfig } from './web-config';
import { PlanScreen } from './plan-page';
import { UpsellPromptHost } from './upsell-host';
import { withEntitlement } from './with-entitlement';

/** The default link: a plain anchor. Pass the router's Link to replace it. */
function PlainAnchor({ to, onClick, children, ...rest }: EntitlementsLinkProps): JSX.Element {
  return (
    <a href={to} onClick={onClick} data-testid={rest['data-testid']}>
      {children}
    </a>
  );
}

export interface WebEntitlements {
  /** The plan screen: pricing cards + the tenant's live status. */
  page: ComponentType;
  /** Mount ONCE in the layout: the upgrade prompt every trigger lands on. */
  UpsellHost: ComponentType;
  /** The page gate. Wrap a routed page's export; pairs with a server guard. */
  withEntitlement: typeof withEntitlement;
}

/**
 * Check the host's wiring, or throw naming the field.
 *
 * Two fields, and both used to be silently defaulted. `apiBase` has no
 * defensible default at all: an empty one makes every request go to `/plan` at
 * the app's own origin, which is a 404 rendered as "could not load your plan" —
 * a wiring mistake wearing a network error's clothes. `canRequestPlanChange` is
 * now required on the type; this is the runtime half, for a host on plain JS.
 */
function assertWebConfig(config: WebEntitlementsConfig): void {
  if (typeof config.apiBase !== 'string' || config.apiBase.trim() === '') {
    throw new Error(
      'createWebEntitlements: `apiBase` is empty. Pass the mount the API half answers ' +
        'at — the same base the host handed entitlementsRouter.',
    );
  }
  if (typeof config.canRequestPlanChange !== 'boolean') {
    throw new Error(
      'createWebEntitlements: `canRequestPlanChange` is required. Pass the resolved ' +
        'answer for whether this caller holds `plan:request`; there is no safe guess.',
    );
  }
}

export function createWebEntitlements(config: WebEntitlementsConfig): WebEntitlements {
  assertWebConfig(config);
  const resolved: ResolvedWebConfig = {
    apiBase: config.apiBase,
    fetchImpl: config.fetchImpl ?? ((...args) => fetch(...args)),
    canRequestPlanChange: config.canRequestPlanChange,
    switchLocation: config.switchLocation ?? (() => null),
    plansPath: config.plansPath ?? null,
    LinkComponent: config.LinkComponent ?? PlainAnchor,
  };

  function Page(): JSX.Element {
    return <PlanScreen config={resolved} />;
  }
  Page.displayName = 'EntitlementsPlanPage';

  function Host(): JSX.Element | null {
    return <UpsellPromptHost config={resolved} />;
  }
  Host.displayName = 'EntitlementsUpsellHost';

  return {
    page: Page,
    UpsellHost: Host,
    withEntitlement,
  };
}
