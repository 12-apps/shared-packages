/**
 * `createWebEntitlements(config)` — the frontend half of the surface, as one
 * factory over config.
 *
 * What the host keeps is exactly what it knows and the package cannot: where
 * the API half is mounted (`apiBase`), whether THIS caller may file a
 * plan-change request (a resolved RBAC answer), where each tenant switch
 * lives in the host's own routes, and which link primitive its router uses.
 * Everything else — the plan screen, the pricing cards, the page lock, the
 * upgrade prompt, the wire parsing — is the package's.
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
  /** The plan screen: pricing cards + the store's live status. */
  page: ComponentType;
  /** Mount ONCE in the layout: the upgrade prompt every trigger lands on. */
  UpsellHost: ComponentType;
  /** The page gate. Wrap a routed page's export; pairs with a server guard. */
  withEntitlement: typeof withEntitlement;
}

export function createWebEntitlements(config: WebEntitlementsConfig): WebEntitlements {
  const resolved: ResolvedWebConfig = {
    apiBase: config.apiBase,
    fetchImpl: config.fetchImpl ?? ((...args) => fetch(...args)),
    canRequestPlanChange: config.canRequestPlanChange ?? false,
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
