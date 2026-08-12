/**
 * The config `createWebEntitlements` closes over — everything the host knows
 * and the surface does not.
 */
import type { ComponentType, ReactNode } from 'react';

/** Where the store's own switch for a feature lives, as the HOST routes it. */
export interface TenantSwitchLocation {
  /** App-relative path, handed to {@link WebEntitlementsConfig.LinkComponent}. */
  path: string;
  /** The screen's name as the link text reads it, e.g. "Configuração › Mesas". */
  label: string;
}

/** The link primitive — the host's router owns navigation, not this package. */
export interface EntitlementsLinkProps {
  to: string;
  onClick?: () => void;
  children: ReactNode;
  'data-testid'?: string;
}

export interface WebEntitlementsConfig {
  /**
   * The mount the API half answers at, e.g. `/api/admin/acme` — the same base
   * the host handed `entitlementsRouter`. The surface builds `/plan` and
   * `/plan/request` out of it.
   */
  apiBase: string;
  /** Defaults to the global `fetch`. The seam a test (or a proxy) replaces. */
  fetchImpl?: typeof fetch;
  /**
   * Whether THIS caller may file a plan-change request — the host's resolved
   * RBAC answer, passed in rather than computed here. The write is refused
   * server-side either way; this only decides whether to render a button
   * that would answer 403.
   */
  canRequestPlanChange?: boolean;
  /**
   * Where the store's own switch for a `disabled-by-tenant` feature lives.
   * Return null for a feature with no dedicated screen; the row then renders
   * without a link. Host routes are the host's — this package cannot know
   * them.
   */
  switchLocation?: (feature: string) => TenantSwitchLocation | null;
  /** The plan screen's own path, for the prompt host's "Ver todos os planos". */
  plansPath?: string;
  /**
   * The anchor the surface renders links with. Defaults to a plain `<a>` over
   * `to` — pass the router's `Link` so client-side navigation survives.
   */
  LinkComponent?: ComponentType<EntitlementsLinkProps>;
}

/** The config with every optional field resolved. */
export interface ResolvedWebConfig {
  apiBase: string;
  fetchImpl: typeof fetch;
  canRequestPlanChange: boolean;
  switchLocation: (feature: string) => TenantSwitchLocation | null;
  plansPath: string | null;
  LinkComponent: ComponentType<EntitlementsLinkProps>;
}
