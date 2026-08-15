/**
 * Chain & policy — priority reordering and the decline policy, over the
 * fictional cast, plus the enable/rank refusal rules.
 *
 * The chain UI mounts on the LANDING LIST only when more than one provider is
 * enabled, so every case here seeds at least two — and every chain assertion
 * happens with no provider screen open.
 *
 * Two refusal cases on purpose. The package's reorder control always sends
 * the RENDERED chain permuted (the `enabled` set), so it can neither add a
 * disabled provider nor omit an enabled one — the two refusals
 * `assertReorderOnly` exists for are unreachable from the UI. `refusal-ui`
 * therefore proves the component's rollback via a host `requireAuth` refusal
 * (the realistic cause: the origin host's quota gate is exactly this shape), and
 * `refusal-wire` issues the two 409s raw at the mount. Trying to make the UI
 * produce them burns the day; the split is not an oversight.
 */
import type { JSX, ReactNode } from 'react';

import { aurora, boreal, cerrado, dunas } from '../payments/admin-adapter';
import { adminCase, PriorityRefusalButtons } from '../payments/admin-cases';
import type { AdminStoreSpec, AdminWorld } from '../payments/admin-store';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

/** Three providers, all proven, all in the chain — the reorderable shape. */
function provenTrio(caseId: string): AdminStoreSpec {
  return {
    providers: [aurora(), boreal(), cerrado()],
    stages: { aurora: 'proven', boreal: 'proven', cerrado: 'proven' },
    chain: ['aurora', 'boreal', 'cerrado'],
    baseUrl: `/api/harness/payments/${caseId}`,
  };
}

/**
 * The two raw `assertReorderOnly` refusals, as data. One seeding serves both
 * legs, and the ORDER of checks decides its shape: listed names are checked
 * before omissions, so the drop leg's one listed name must itself be enabled.
 *
 *  - rank-disabled LISTS the stored-but-disabled provider beside both enabled
 *    rows (no omission in this leg at all) → `assertRankable`: it is proven,
 *    but reordering ranks and cannot enable → 409 CredentialsError.
 *  - drop-grandfathered OMITS the enabled-but-unproven row — activation
 *    charge declared, never landed, enabled by the raw ranking pass exactly
 *    as the FUT-463 migration left pre-existing stores → `assertDroppable`:
 *    409 IrreversibleChainRemovalError.
 */
function refusalLegs(world: AdminWorld): ReactNode {
  return (
    <PriorityRefusalButtons
      world={world}
      legs={[
        {
          testid: 'admin-rank-disabled',
          label: 'Ranquear provedor desativado',
          providers: ['aurora', 'boreal', 'dunas'],
        },
        {
          testid: 'admin-drop-grandfathered',
          label: 'Omitir provedor sem prova',
          providers: ['boreal'],
        },
      ]}
    />
  );
}

const CASES: readonly HarnessCase[] = [
  adminCase('reorder', 'Reorder the chain', provenTrio('reorder')),
  adminCase('policy', 'Decline policy', provenTrio('policy')),
  // The enable rule, both arms: an activation-charge provider that never
  // charged is gated; one without the requirement toggles freely. The third
  // provider is enabled so flipping the free one puts a chain on screen.
  adminCase('enable-gate', 'Activation gate', {
    providers: [aurora(), boreal(), cerrado()],
    stages: { aurora: 'connected', boreal: 'connected', cerrado: 'proven' },
    chain: ['cerrado'],
    baseUrl: '/api/harness/payments/enable-gate',
  }),
  // The one refusal the reorder control CAN surface — the host refuses the
  // intent before any handler runs — proving the optimistic rollback.
  adminCase('refusal-ui', 'Reorder refused (rollback)', {
    ...provenTrio('refusal-ui'),
    refuse: { kind: 'setPriorities', status: 409 },
  }),
  adminCase(
    'refusal-wire',
    'Reorder refusals (wire)',
    {
      providers: [aurora(), boreal(), dunas()],
      stages: { aurora: 'connected', boreal: 'connected', dunas: 'oauth-connected' },
      chain: ['aurora', 'boreal'],
      baseUrl: '/api/harness/payments/refusal-wire',
    },
    { controls: refusalLegs },
  ),
];

export function PaymentsProviderChainPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Provider settings · chain &amp; policy">
        The failover chain on the landing list: reordering (whole chain on the wire, server order
        back), the decline-policy switch, the activation gate on the enable toggle, and the
        reorder refusals — one through the component with its rollback, two issued raw at the
        mount because the component can never send them.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
