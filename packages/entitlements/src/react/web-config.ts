/**
 * The config `createWebEntitlements` closes over — everything the host knows
 * and the surface does not.
 */
import type { ComponentType, ReactNode } from 'react';

import type { EntitlementsWebCopy } from './copy';

/** Where the tenant's own switch for a feature lives, as the HOST routes it. */
export interface TenantSwitchLocation {
  /** App-relative path, handed to {@link WebEntitlementsConfig.LinkComponent}. */
  path: string;
  /** The screen's name as the link text reads it, in the host's own words. */
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
   * Whether THIS caller holds `plan:request` — the host's resolved RBAC
   * answer, passed in rather than computed here, because a browser cannot hold
   * policy. The write is refused server-side either way; this only decides
   * whether to render a button that would answer 403.
   *
   * REQUIRED: it used to default to `false`, which renders a plan screen with
   * no way to ask for a plan on it. Fail-closed, and therefore silent — the
   * only symptom is a button nobody ever sees.
   */
  canRequestPlanChange: boolean;
  /**
   * Every sentence the screens render — REQUIRED, the host's words. pt-BR
   * hosts pass `PT_BR_ENTITLEMENTS_WEB_COPY` from `./pt-BR` (re-exported at
   * `@12-apps/entitlements/react`).
   */
  copy: EntitlementsWebCopy;
  /**
   * Where the tenant's own switch for a `disabled-by-tenant` feature lives.
   * Return null for a feature with no dedicated screen; the row then renders
   * without a link. Host routes are the host's — this package cannot know
   * them.
   */
  switchLocation?: (feature: string) => TenantSwitchLocation | null;
  /** The plan screen's own path, for the prompt host's "Ver todos os planos". */
  plansPath?: string;
  /**
   * Where the host routes the feature AUDIT — the same surface's other half.
   * Optional like `plansPath`, and for the same reason: a host that mounts no
   * such route gets no link rather than a dead one.
   */
  featuresPath?: string;
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
  copy: EntitlementsWebCopy;
  switchLocation: (feature: string) => TenantSwitchLocation | null;
  plansPath: string | null;
  featuresPath: string | null;
  LinkComponent: ComponentType<EntitlementsLinkProps>;
}
