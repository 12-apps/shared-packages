import { expect, test, type Page } from '@playwright/test';
import { expectNoWritesOn, type NoWriteProbe } from '@12-apps/payments-e2e';

import { openCase, openPage } from './helpers/checkout';

/**
 * A self-test of the packaged "nenhum pedido chegou a ser criado" check
 * (FUT-4028): it must go RED when something was written, and when the probe
 * it reads is not recording. A check that only ever passes proves nothing.
 *
 * The store cannot charge (no provider), so the checkout itself writes
 * nothing; the probe's own controls send the heartbeat read and, for the red
 * cases, a forced write, through the same recorder the checkout uses.
 */

async function onTheNoProviderScreen(page: Page): Promise<void> {
  await openPage(page, 'payments-checkout-no-provider');
  await openCase(page, 'empty-chain');
  await expect(page.getByTestId('checkout-payments-disabled')).toBeVisible();
}

/** The probe as the harness world registers it: its paths and its heartbeat. */
function liveProbe(page: Page): NoWriteProbe {
  return {
    paths: page.getByTestId('wire-paths'),
    heartbeat: async (on) => {
      await on.getByTestId('wire-heartbeat').click();
      return 'GET /api/checkout/heartbeat';
    },
  };
}

test('passes on a screen that wrote nothing, once the probe is shown live', async ({ page }) => {
  await onTheNoProviderScreen(page);
  await expectNoWritesOn(page, liveProbe(page));
  await expect(page.getByTestId('wire-paths')).toContainText('GET /api/checkout/heartbeat');
});

test('goes red on a write that is already on the wire', async ({ page }) => {
  await onTheNoProviderScreen(page);
  await page.getByTestId('wire-force-write').click();
  await expect(page.getByTestId('wire-paths')).toContainText('POST /api/checkout/heartbeat');
  await expect(expectNoWritesOn(page, liveProbe(page))).rejects.toThrow(/a write reached the wire/);
});

test('goes red on a write that lands while it watches', async ({ page }) => {
  await onTheNoProviderScreen(page);
  const probe = liveProbe(page);
  const check = expectNoWritesOn(page, {
    ...probe,
    // The write goes out right after the heartbeat, inside the settle window.
    heartbeat: async (on) => {
      const line = await probe.heartbeat?.(on);
      await on.getByTestId('wire-force-write').click();
      return line ?? '';
    },
  });
  await expect(check).rejects.toThrow(/a write reached the wire/);
});

test('goes red when the probe does not record the heartbeat', async ({ page }) => {
  await onTheNoProviderScreen(page);
  // A heartbeat that sends nothing: the line it promises never shows up.
  const dead: NoWriteProbe = {
    paths: page.getByTestId('wire-paths'),
    heartbeat: async () => 'GET /api/checkout/heartbeat',
  };
  await expect(expectNoWritesOn(page, dead)).rejects.toThrow(/not live/);
});
