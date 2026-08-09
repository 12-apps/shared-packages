/**
 * Connect (OAuth) — prepare → provider → callback, over the fictional cast.
 *
 * Everything below the address bar is the shipped code: the host's prepare
 * extension mints the CSRF state, the published client's `beginOAuth` asks the
 * mount, the adapter builds an authorize URL that differs from the current URL
 * only in its FRAGMENT (so the hop is a same-document navigation and the
 * in-page world survives), the harness consent panel sends the browser back,
 * and the host's callback extension performs the CSRF comparison before the
 * published `oauth.complete` writes the tokens. Simulated: the consent screen,
 * the code string, and the network hop — nothing about the connection's state.
 *
 * Selection is UNCONTROLLED here, driven by `initialProvider` from the
 * callback landing — the other half of the package's selection contract, and
 * the path a real callback actually uses.
 */
import type { JSX, ReactNode } from 'react';

import { cerrado, dunas } from '../payments/admin-adapter';
import { adminCase, RawRequestButton } from '../payments/admin-cases';
import type { AdminWorld } from '../payments/admin-store';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

/** Distinct per case — the client's baseUrl AND the localStorage ack scope. */
function base(caseId: string): string {
  return `/api/harness/payments/${caseId}`;
}

/**
 * The `completeOAuth` exclusion's live proof: the library's own complete
 * route must answer 404 on every admin mount — the callback is a HOST route
 * here, because the CSRF comparison happens where the session lives. Issued
 * raw; the published client has no `completeOAuth` method to issue it with.
 */
function probeComplete(world: AdminWorld): ReactNode {
  return (
    <RawRequestButton
      world={world}
      testid="admin-probe-complete"
      label="Chamar completeOAuth da biblioteca"
      method="POST"
      route="/settings/providers/cerrado/oauth/complete"
    />
  );
}

const CASES: readonly HarnessCase[] = [
  // Non-empty schema, so the manual-credentials accordion renders collapsed
  // beside the connect button — the `prepareConnect`-present branch.
  adminCase(
    'connect',
    'Full round trip',
    { providers: [cerrado()], baseUrl: base('connect') },
    { connect: true, controls: probeComplete },
  ),
  // Empty schema: connect button, no accordion — the false arm of the same
  // branch.
  adminCase(
    'no-fallback',
    'No manual fallback',
    { providers: [dunas()], baseUrl: base('no-fallback') },
    { connect: true },
  ),
  // Same provider as `connect`, `prepareConnect` omitted — the only variable
  // is the prop the branch keys on: info alert, bare form, no button.
  adminCase('no-prepare', 'Host without prepareConnect', {
    providers: [cerrado()],
    baseUrl: base('no-prepare'),
  }),
  // The FUT-683 shape: the grant died, the owner never switched anything off.
  // Seeded THROUGH the published service (`oauth.refresh` against an adapter
  // whose refresh throws), and listed in `chain` so the row stays enabled
  // while out of rotation — reconnecting must re-enter rotation by itself.
  adminCase(
    'reconnect',
    'Reconnect required',
    {
      providers: [cerrado({ refreshFails: true })],
      stages: { cerrado: 'reconnect-required' },
      chain: ['cerrado'],
      baseUrl: base('reconnect'),
    },
    { connect: true },
  ),
  // Enabled and connected, so the disconnect's full cost — tokens, status,
  // proof, enablement — is visible when it lands.
  adminCase(
    'disconnect',
    'Disconnect',
    {
      providers: [cerrado()],
      stages: { cerrado: 'oauth-connected' },
      chain: ['cerrado'],
      baseUrl: base('disconnect'),
    },
    { connect: true },
  ),
  // `oauth.revoke` throws: the disconnect must still complete locally, and
  // the failure lands in the reporter sink instead of being swallowed.
  adminCase(
    'revoke-fails',
    'Revoke fails upstream',
    { providers: [dunas()], stages: { dunas: 'oauth-connected' }, baseUrl: base('revoke-fails') },
    { connect: true },
  ),
  adminCase(
    'expiring',
    'Authorization expiring',
    { providers: [cerrado()], stages: { cerrado: 'expiring' }, baseUrl: base('expiring') },
    { connect: true },
  ),
  // `appCredentialsFor` answers null: `beginOAuth` refuses with the package's
  // own 409 before any provider hop happens.
  adminCase(
    'unregistered-app',
    'No platform app registered',
    { providers: [cerrado()], unregisteredApps: ['cerrado'], baseUrl: base('unregistered-app') },
    { connect: true },
  ),
  // Three failure legs off the consent screen: deny (no callback at all),
  // tampered state (403 before any code is spent), refused code (the host
  // guard's 502 mapping of the provider's throw).
  adminCase(
    'refusals',
    'Consent refusals',
    { providers: [cerrado()], baseUrl: base('refusals') },
    { connect: true },
  ),
];

export function PaymentsProviderConnectPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Provider settings · connect (OAuth)">
        The connect round trip over fictional providers: the host mints the state, the published
        client begins, a fragment-only hop lands on the consent panel, and the host callback
        completes through the published service. Plus the reconnect banner, disconnect and its
        confirmation, the expiry captions, and every refusal leg of the trip.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
