/**
 * Catalog — the landing page of the merchant `payments-admin` parent, and THE
 * ONE PAGE allowed to spell a vendor name: this exact path is a hard-coded
 * exemption in `eslint.payments-portability.config.mjs`, so the slug cannot
 * move. Every other page of the parent runs on the fictional cast in
 * `../payments/admin-adapter.ts`.
 *
 * Nothing here is a mock of OUR code. The registry, the adapters, the
 * settings service, the mount and the settings screen are the real published
 * ones; only the network is replaced, by routing the published client's
 * `fetchImpl` straight into the in-page mount (see `../payments/admin-store`).
 *
 * The vendor adapters are imported for DESCRIPTOR PROJECTION ONLY, and the
 * mount makes that true by construction: `CATALOG_EXCLUDE` below leaves only
 * `getSettings` and `getSetupGuide` standing (the setup-guide modules are
 * pure — type-only imports), so a stray click cannot make a vendor adapter
 * place a cross-origin call or reach a crypto-backed path. `node:crypto` is
 * externalized by the build and only throws when CALLED; nothing on this page
 * calls it. Removing an entry from `CATALOG_EXCLUDE` re-opens exactly that
 * risk — `admin-probe-write` is the exclusion's live proof.
 */
import type { JSX, ReactNode } from 'react';

import { defineProviders, type PaymentsIntentKind } from '@12-apps/payments-backend';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { pagbankProvider } from '@12-apps/payments-backend/providers/pagbank';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

import { adminCase, RawRequestButton } from '../payments/admin-cases';
import type { AdminStoreSpec, AdminWorld } from '../payments/admin-store';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY, PT_BR_STONE_COPY, PT_BR_STRIPE_COPY } from '@12-apps/payments-backend';

/** The published catalog, composed the way a host composes it. */
const registry = defineProviders({
  pagbank: pagbankProvider(PT_BR_PAGBANK_COPY),
  stone: stoneProvider(PT_BR_STONE_COPY),
  infinitepay: infinitePayProvider(PT_BR_INFINITEPAY_COPY),
  stripe: stripeProvider(PT_BR_STRIPE_COPY),
});

/**
 * All twelve non-`getSettings`/`getSetupGuide` members of the canonical route
 * table. Only the two reads survive, so the mount answers 404 before any
 * vendor adapter method runs — read-only BY CONSTRUCTION, not by discipline.
 */
const CATALOG_EXCLUDE: PaymentsIntentKind[] = [
  'createCharge',
  'getCharge',
  'handleWebhook',
  'getClientConfig',
  'completeOAuth',
  'saveCredentials',
  'setEnabled',
  'setPriorities',
  'setFailoverPolicy',
  'verify',
  'beginOAuth',
  'disconnectOAuth',
];

/** Same mount for every case; only the baseUrl (case isolation) differs. */
function catalogSpec(caseId: string): AdminStoreSpec {
  return { registry, exclude: CATALOG_EXCLUDE, baseUrl: `/api/harness/payments/${caseId}` };
}

/**
 * The exclusion's live proof: one write at the mount, issued raw (the
 * published client throws on a non-2xx, which would report the refusal by
 * exploding instead of by printing a status). Expected answer: 404.
 */
function probeWrite(world: AdminWorld): ReactNode {
  return (
    <RawRequestButton
      world={world}
      testid="admin-probe-write"
      label="Tentar gravação direta"
      method="PUT"
      route="/settings/providers/stone"
      body={{ environment: 'SANDBOX', fields: {} }}
    />
  );
}

/**
 * Four cases, one mount shape. They exist so each spec lands on its own
 * world (distinct baseUrl = distinct localStorage ack scope and wire log):
 * `catalog` pins the four cards and read-only-ness, `slug-alias` lands
 * controlled on the raw `infinitepay` name and watches the canonical
 * `infinite-pay` respelling arrive with `{replace: true}`, `guides` opens the
 * one vendor that ships a setup guide and the one that ships none — plus a
 * CONNECTED stripe row, because a guide is no longer a constant: the stage it
 * opens on is computed from the store's progress, and only a non-fresh
 * fixture can prove the stepper moves past step 1 (FUT-691). The row is
 * seeded straight into the store; the mount stays read-only.
 *
 * `guide-brand` is the fourth, and it is a separate case rather than a flag on
 * `guides` because it needs STONE connected: the sentence that addresses the
 * platform by name lives in Stone's webhook section, and a guide renders the
 * section of the stage it opens on — a fresh row opens on "gerar chaves" and
 * the sentence is simply not in the DOM. Seeding it into `guides` instead
 * would have changed the fixture two other specs assert against, to make a
 * third one's text appear.
 */
const CASES: readonly HarnessCase[] = [
  adminCase('catalog', 'Published catalog', catalogSpec('catalog'), {
    controlled: true,
    controls: probeWrite,
  }),
  adminCase('slug-alias', 'Alias landing', catalogSpec('slug-alias'), {
    controlled: true,
    controls: probeWrite,
  }),
  adminCase('guides', 'Setup guides', { ...catalogSpec('guides'), stages: { stripe: 'connected' } }, {
    controlled: true,
    controls: probeWrite,
  }),
  adminCase(
    'guide-brand',
    'Guide names the host',
    { ...catalogSpec('guide-brand'), stages: { stone: 'connected' } },
    { controlled: true, controls: probeWrite },
  ),
];

export function PaymentsProviderSettingsPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Provider settings · catalog">
        The four published vendor adapters, projected by the real settings service into the real
        settings screen — read-only by construction, with selection kept in the hash query
        (controlled mode, the URL contract the production admin implements). The other pages of
        this parent exercise the writes, over fictional providers.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
