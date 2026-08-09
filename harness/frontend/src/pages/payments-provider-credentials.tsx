/**
 * Credentials — the schema-driven form over the fictional cast: the dirty
 * rule, the confirm-on-save dialog, "saving IS testing" (the package's own
 * POST verify probe, environment included), the environment tabs, the enabled
 * toggle and its activation gate, and the guided setup walkthrough.
 *
 * Every case passes `renderVerification`: the context object the package
 * hands the host's activation step, printed verbatim as a marker node with no
 * behaviour. That slot is the package's ENTIRE surface for the host-owned
 * activation-charge flows (FUT-463), so pinning it here is what makes their
 * exclusion from the harness a carve-out rather than a hole.
 *
 * The three probe cases are three CASES rather than one case toggled twice on
 * purpose: a case that changes the adapter's answer partway through couples
 * two assertions to an execution order nothing enforces.
 */
import type { JSX, ReactNode } from 'react';

import type { PaymentProviderSettingsProps } from '@12-apps/payments-frontend';

import { aurora, boreal } from '../payments/admin-adapter';
import { adminCase, ReleaseVerifyButton } from '../payments/admin-cases';
import type { AdminStoreSpec, AdminWorld } from '../payments/admin-store';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

type RenderVerification = NonNullable<PaymentProviderSettingsProps['renderVerification']>;

/**
 * The activation step's context, printed verbatim — one `|`-joined line, in
 * declaration order. Nothing in it charges anything; the flows behind it are
 * host-owned and live in the production admin.
 */
const renderVerificationContext: RenderVerification = (ctx) => (
  <span data-testid="admin-verification-context">
    {`${ctx.provider}|${ctx.displayName}|${ctx.connected}|${ctx.proven}|${ctx.blocked}|${ctx.hidden}`}
  </span>
);

/** Releases the probe the `deferred` adapter is holding open. */
function releaseVerify(world: AdminWorld): ReactNode {
  return <ReleaseVerifyButton world={world} />;
}

/** Every case here carries the verification marker; the id keys the world. */
function credentialsCase(
  id: string,
  label: string,
  spec: Omit<AdminStoreSpec, 'baseUrl'>,
  controls?: (world: AdminWorld) => ReactNode,
): HarnessCase {
  return adminCase(
    id,
    label,
    { ...spec, baseUrl: `/api/harness/payments/${id}` },
    { renderVerification: renderVerificationContext, controls },
  );
}

const CASES: readonly HarnessCase[] = [
  credentialsCase('first-save', 'First save', { providers: [aurora()] }),
  // Proven and in rotation, so re-typing the same handle keeping the proof —
  // and a different handle dropping proof AND enablement — are both visible.
  credentialsCase('rotate', 'Rotate a proven handle', {
    providers: [aurora()],
    stages: { aurora: 'proven' },
    chain: ['aurora'],
  }),
  credentialsCase('masked', 'Stored secrets', {
    providers: [boreal()],
    stages: { boreal: 'connected' },
  }),
  credentialsCase('environments', 'Environment tabs', {
    providers: [aurora()],
    stages: { aurora: 'connected' },
  }),
  credentialsCase('probe-failed', 'Probe fails', {
    providers: [boreal({ verify: { ok: false, message: 'Chave de API rejeitada pelo provedor.' } })],
    stages: { boreal: 'saved' },
  }),
  credentialsCase('probe-unreachable', 'Probe unreachable', {
    providers: [
      boreal({
        verify: { ok: false, fault: 'UNREACHABLE', message: 'Não foi possível falar com o provedor.' },
      }),
    ],
    stages: { boreal: 'saved' },
  }),
  credentialsCase(
    'probe-slow',
    'Probe held open',
    { providers: [boreal({ verify: 'deferred' })], stages: { boreal: 'saved' } },
    releaseVerify,
  ),
  credentialsCase('guided-setup', 'Guided walkthrough', { providers: [aurora()] }),
  // The quota shape future-pay bills on `setEnabled`: the host refuses the
  // ENABLE (body `enabled: true`) and only that, so switching off still works.
  credentialsCase('quota', 'Enable refused (quota)', {
    providers: [boreal()],
    stages: { boreal: 'connected' },
    chain: ['boreal'],
    refuse: { kind: 'setEnabled', status: 403, whenEnabled: true },
  }),
];

export function PaymentsProviderCredentialsPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Provider settings · credentials">
        The credential form end to end, over fictional providers: the dirty rule, the
        confirm-on-save dialog, the probe that runs on save, the environment tabs, the enabled
        toggle and the walkthrough guide. The verification slot renders its context object
        verbatim — the one handle the package gives the host-owned activation flows.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
