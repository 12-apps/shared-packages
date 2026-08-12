import { useEffect, useState, type JSX } from 'react';

import { EntitlementsProvider, createWebEntitlements } from '@12-apps/entitlements/react';
import type { EntitlementSnapshot } from '@12-apps/entitlements/react';

/**
 * `@12-apps/entitlements` mounted the way a host mounts it: one
 * `createWebEntitlements` call, driving the REAL API half served by
 * harness/backend through the Vite proxy — the arrangement a real admin SPA
 * has, so what these screens prove is the published wiring, not a component.
 *
 * The host keeps exactly its own knowledge: where the API is mounted, that
 * THIS caller may ask for a plan change (a resolved RBAC answer), where each
 * tenant switch lives in its routes, and its router's link. Everything
 * rendered below the heading — the pricing cards, the status rows, the page
 * lock, the upgrade prompt — is the package's.
 *
 * The gated section mirrors future-pay's `withEntitlement` pages: the seeded
 * tenant is on the free tier, so the audit area renders the package's
 * full-page lock, and its "Saiba mais" funnels into the same upsell prompt a
 * 402 would.
 */
const API_BASE = '/api/admin/harness';

const { page: PlanPage, UpsellHost, withEntitlement } = createWebEntitlements({
  apiBase: API_BASE,
  canRequestPlanChange: true,
  // The host's own route map: where each tenant switch actually lives.
  switchLocation: (feature) =>
    feature === 'storefront.tables'
      ? { path: '#/entitlements-plan', label: 'Configuração › Mesas' }
      : null,
  plansPath: '#/entitlements-plan',
});

/** A host page that exists only behind the plan gate. */
function AuditArea(): JSX.Element {
  return <div data-testid="audit-area">Registro de atividades da loja</div>;
}

const GatedAuditArea = withEntitlement('audit', AuditArea);

export function EntitlementsPlanPage(): JSX.Element {
  const [snapshot, setSnapshot] = useState<EntitlementSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  // The bootstrap read every SPA shell performs once: the server-resolved
  // snapshot the provider renders from. The client never re-resolves.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/entitlements`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`snapshot ${response.status}`);
        return (await response.json()) as { snapshot: EntitlementSnapshot };
      })
      .then(
        (body) => {
          if (alive) setSnapshot(body.snapshot);
        },
        () => {
          if (alive) setFailed(true);
        },
      );
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <p data-testid="entitlements-error">snapshot indisponível</p>;
  if (snapshot === null) return <p data-testid="entitlements-loading">carregando…</p>;

  return (
    <EntitlementsProvider snapshot={snapshot}>
      <section data-testid="entitlements-plan-page">
        {/* The gate, on a page the free tier does not include: the package's
            in-shell lock, whose button raises the upgrade prompt. */}
        <GatedAuditArea />

        {/* The plan screen itself. */}
        <PlanPage />

        {/* Mounted ONCE, the way a tenant layout mounts it. */}
        <UpsellHost />
      </section>
    </EntitlementsProvider>
  );
}
