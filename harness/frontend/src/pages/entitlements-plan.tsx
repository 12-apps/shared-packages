import { useEffect, useState, type JSX } from 'react';

import {
  EntitlementsProvider,
  PT_BR_ENTITLEMENTS_WEB_COPY,
  createWebEntitlements,
} from '@12-apps/entitlements/react';
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
 * The gated section is a `withEntitlement` page: the seeded tenant is on the
 * cheapest tier, so the jury area renders the package's full-page lock, and
 * its "Saiba mais" funnels into the same upsell prompt a 402 would.
 */
const API_BASE = '/api/admin/harness';

const { page: PlanPage, UpsellHost, withEntitlement } = createWebEntitlements({
  apiBase: API_BASE,
  canRequestPlanChange: true,
  // The screens' sentences, passed by hand — required config; the package no
  // longer ships a default voice.
  copy: PT_BR_ENTITLEMENTS_WEB_COPY,
  // The host's own route map: where each tenant switch actually lives.
  switchLocation: (feature) =>
    feature === 'submissions.notes'
      ? { path: '#/entitlements-plan', label: 'Ajustes › Curadoria' }
      : null,
  plansPath: '#/entitlements-plan',
});

/** A host page that exists only behind the plan gate. */
function JuryArea(): JSX.Element {
  return <div data-testid="jury-area">Sala de júri da mostra</div>;
}

const GatedJuryArea = withEntitlement('jury.deliberation', JuryArea);

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
        // The `{ data: … }` SUCCESS envelope — the surface's wire contract.
        return (await response.json()) as { data: { snapshot: EntitlementSnapshot } };
      })
      .then(
        (body) => {
          if (alive) setSnapshot(body.data.snapshot);
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
        {/* The gate, on a page the cheapest tier does not include: the
            package's in-shell lock, whose button raises the upgrade prompt. */}
        <GatedJuryArea />

        {/* The plan screen itself. */}
        <PlanPage />

        {/* Mounted ONCE, the way a tenant layout mounts it. */}
        <UpsellHost />
      </section>
    </EntitlementsProvider>
  );
}
