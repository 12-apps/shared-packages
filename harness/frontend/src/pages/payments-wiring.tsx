import { useEffect, useState, type ComponentType, type JSX } from 'react';

import { PT_BR_PAYMENTS_SETTINGS_COPY } from '@12-apps/payments-frontend';

import { adminReady, checkoutSurface, settingsSurface } from '../payments/wiring';

/**
 * Both payments surfaces, rendered from the ADOPTION rather than from a direct
 * factory call — see `src/payments/wiring.ts` for why there is one adoption and
 * twenty-two scenario pages beside it.
 *
 * This page exists so the adoption is not decorative. Binding a manifest and
 * never rendering what it returns would put the package in the report while
 * proving nothing about the surface the report claims is bound — which is the
 * same shape of empty green this series keeps running into.
 */

/**
 * The COPY stays a per-render prop, and that is the manifest's own call.
 *
 * Every other config this host answers is bound once at the adoption. Copy is
 * not, deliberately: it follows the READER's locale, and freezing it at bind
 * time would pin both surfaces to whichever language was in effect when the
 * host built them — the same reason `@12-apps/i18n`'s resolver is called where
 * a sentence is USED rather than where a surface is mounted.
 */
const SettingsPage = settingsSurface.page as ComponentType<{
  copy: typeof PT_BR_PAYMENTS_SETTINGS_COPY;
}>;
const Checkout = checkoutSurface.Checkout;

export function PaymentsWiringPage(): JSX.Element {
  const [seeded, setSeeded] = useState(false);

  // The admin world seeds asynchronously; the CLIENT the surface is bound to is
  // synchronous. A real host boots in this order too — the screen mounts and
  // reads through its client — but a spec that clicked before the seed landed
  // would be racing the fixture rather than testing the surface.
  useEffect(() => {
    let alive = true;
    void adminReady.then(() => {
      if (alive) setSeeded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div data-testid="page-payments-wiring">
      <h2>Adopted through the wiring consumer</h2>

      <section data-testid="adopted-settings">
        <h3>Provider settings</h3>
        {seeded ? <SettingsPage copy={PT_BR_PAYMENTS_SETTINGS_COPY} /> : <p data-testid="adopted-settings-seeding">carregando…</p>}
      </section>

      <section data-testid="adopted-checkout">
        <h3>Checkout</h3>
        <Checkout />
      </section>
    </div>
  );
}
