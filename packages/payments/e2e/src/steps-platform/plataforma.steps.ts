import { expect } from '@playwright/test';

import { paymentsPlatformWorld } from '../platform-world.js';

import { Given, Then, When } from '../steps/fixtures.js';

/**
 * THE PLATFORM OPERATOR'S STEPS (FUT-479 / FUT-483, packaged by FUT-573).
 *
 * A separate file tree from `../steps/` on purpose: these register step
 * definitions for the PLATFORM journeys, which a host opts into with the
 * `paymentsPlatformSteps` glob. Compiling them into the buyer steps' glob
 * would hand every checkout-only consumer a set of orphan definitions — and
 * an orphan definition is exactly what a strict bdd gate fails on.
 *
 * Every Then reads a test id the payments package's own platform components
 * render, so the assertions mean the same thing in any host that mounts
 * `ConnectApplicationPanel` / `PlatformHomologacao`.
 */

// ---------------------------------------------------------------------------
// The Connect application (FUT-479)
// ---------------------------------------------------------------------------

Given(
  'a operadora abre a aplicação Connect de uma instalação sem aplicação registrada',
  async ({ page }) => {
    await paymentsPlatformWorld().openConnectApplication(page, 'unconfigured');
  },
);

Then('ela vê o callback desta instalação', async ({ page }) => {
  const callback = page.getByTestId('connect-expected-redirect');
  await expect(callback).toBeVisible();
  // The exact URL is the host's own; what the journey pins is that SOMETHING
  // is spelled out for the operator to compare against.
  await expect(callback).not.toHaveText('');
});

Then('cada ambiente aparece em seu próprio cartão', async ({ page }) => {
  await expect(page.getByTestId('connect-env-SANDBOX')).toBeVisible();
  await expect(page.getByTestId('connect-env-PRODUCTION')).toBeVisible();
});

Then('os dois ambientes se declaram sem aplicação configurada', async ({ page }) => {
  await expect(page.getByTestId('connect-env-SANDBOX')).toContainText(
    'Nenhuma aplicação configurada neste ambiente.',
  );
  await expect(page.getByTestId('connect-env-PRODUCTION')).toContainText(
    'Nenhuma aplicação configurada neste ambiente.',
  );
});

// ---------------------------------------------------------------------------
// The homologação (FUT-483)
// ---------------------------------------------------------------------------

Given(
  'a operadora abre a homologação de uma plataforma que nunca a solicitou',
  async ({ page }) => {
    await paymentsPlatformWorld().openHomologacao(page, 'unrequested');
  },
);

Then('a situação é {string}', async ({ page }, label: string) => {
  await expect(page.getByTestId('homologacao-status-chip')).toHaveText(label);
});

Then('o formulário oficial está a um clique', async ({ page }) => {
  const link = page.getByTestId('homologacao-form-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /pipefy/);
});

Then('as respostas prontas nomeiam a API de Pedidos e a API Connect', async ({ page }) => {
  const services = page.getByTestId('homologacao-services');
  await expect(services).toContainText('API de Pedidos e Pagamentos (Order)');
  await expect(services).toContainText('API Connect');
});

When('ela registra o protocolo da solicitação', async ({ page }) => {
  await page.getByTestId('homologacao-protocol').fill('PIPE-journey-001');
  await page.getByTestId('homologacao-save').click();
});

Then('o registro é confirmado', async ({ page }) => {
  await expect(page.getByTestId('homologacao-save-ok')).toBeVisible();
});

/**
 * The chip flipping WITHOUT a reload is the point: the host's save must
 * refresh the `record` the component renders — the wiring the port's
 * docstring demands.
 */
Then('a situação passa a ser {string}', async ({ page }, label: string) => {
  await expect(page.getByTestId('homologacao-status-chip')).toHaveText(label);
});

When('ela tenta gerar o anexo de evidências', async ({ page }) => {
  await page.getByTestId('homologacao-anexo-button').click();
});

Then('ela vê o motivo pelo qual o anexo não saiu', async ({ page }) => {
  await expect(page.getByTestId('homologacao-anexo-error')).not.toBeEmpty();
});
