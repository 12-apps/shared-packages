import { expect, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { mcpConnectWorld } from '../world.js';

/**
 * The packaged AI-connect journeys' step definitions.
 *
 * Every locator is a test id THIS package's own components render —
 * `ai-landing`, `ai-host-select`, `ai-copy-step`, `ai-configure-step`,
 * `ai-connect-step`, `ai-confirm-waiting`, `mcp-endpoint-url` — which is what
 * makes the scenarios portable: they mean the same thing in any app mounting
 * `AiIntegrationOnboarding`. Everything a host owns (sign-in, where the flow is
 * mounted, which assistants it offers) arrives through the world port.
 *
 * ## Why `package.json` declares this file under `sideEffects`
 *
 * Every Given/When/Then below runs at IMPORT time — registering a step is the
 * whole point of the module, and it exports nothing anybody imports by name. To
 * a bundler doing tree-shaking that reads as dead weight, and dropping it is
 * licensed: the result is a suite where bddgen reports the features compiled
 * and every scenario then fails on an undefined step.
 *
 * Not one step asserts a SENTENCE. The assistants' names, the button words and
 * the permission prose are REQUIRED host config (FUT-760) — this package ships
 * no assistant and no copy of its own — so a spec written against them could
 * only ever have run in one adopter.
 */
const { Given, When, Then } = createBdd();

Given('I am signed in as somebody who may connect an assistant', async ({ page }) => {
  await mcpConnectWorld().signInAsOwner(page);
});

When('I open the AI integration screen', async ({ page }) => {
  await mcpConnectWorld().openAiIntegrationScreen(page);
  await expect(page.getByTestId('ai-onboarding')).toBeVisible();
});

Then('the landing explains the permission model before anything is connected', async ({ page }) => {
  await expect(page.getByTestId('ai-landing')).toBeVisible();
  // The callout is the point of the landing: an owner is about to hand a third
  // party a key to their store, and this is the screen that says what the key
  // opens. It renders BEFORE any assistant is chosen, which is the only moment
  // the answer is still "nothing".
  await expect(page.getByTestId('ai-permission-callout')).toBeVisible();
});

Then('it shows examples of what an assistant can be asked', async ({ page }) => {
  await expect(page.getByTestId('ai-capability-examples')).toBeVisible();
});

When('I start the walkthrough', async ({ page }) => {
  await page.getByTestId('ai-landing-start').click();
  await expect(page.getByTestId('ai-host-select')).toBeVisible();
});

When('I choose an assistant that has no one-click install', async ({ page }) => {
  // The flow BRANCHES on the guide's `pluginUrl`: with one it becomes
  // Escolher → Instalar → Confirmar and there is no endpoint to copy at all.
  // The host names a guide that takes the manual path, because which
  // assistants exist is its configuration and not this package's.
  await page.getByTestId(`ai-host-card-${mcpConnectWorld().fixtures.manualHostId}`).click();
});

Then("I am asked to copy the store's endpoint", async ({ page }) => {
  await expect(page.getByTestId('ai-copy-step')).toBeVisible();
  await expect(page.getByTestId('mcp-endpoint-url')).toContainText(
    mcpConnectWorld().fixtures.endpointUrl,
  );
});

/** Copying is the ACTION that advances this step — there is no next button. */
async function copyEndpoint(page: Page): Promise<void> {
  await page.getByTestId('ai-copy-endpoint').click();
}

/**
 * Open the assistant's connector page — the one action that unlocks "next".
 *
 * By its OWN id, not `getByRole('link')`: this control is a Button calling
 * `window.open`, and the only real `<a>` in the step is the DOCS link, which
 * deliberately does not unlock anything. A role query would have taken the
 * docs link and then failed on an assertion about the button.
 */
async function openConnectorPage(page: Page): Promise<void> {
  await page.getByTestId(`ai-host-link-${mcpConnectWorld().fixtures.manualHostId}`).click();
}

When('I copy the endpoint', async ({ page }) => {
  await copyEndpoint(page);
});

Then('the walkthrough has moved on to configuring the connector', async ({ page }) => {
  // The claim is that COPYING advanced it. The copy step offers no "next", so
  // reaching the configure step at all proves the copy handler drove the
  // wizard rather than some button the operator happened to press.
  await expect(page.getByTestId('ai-configure-step')).toBeVisible();
  await expect(page.getByTestId('ai-copy-step')).toHaveCount(0);
});

Then('continuing is refused until I open the connector page', async ({ page }) => {
  // The guard that stops an owner walking past the one step that does the
  // actual work: the connector page has to be opened before "next" unlocks.
  await expect(page.getByTestId('ai-configure-next')).toBeDisabled();
});

Then('once opened, continuing reaches the connect step', async ({ page }) => {
  await openConnectorPage(page);
  await expect(page.getByTestId('ai-configure-next')).toBeEnabled();
  await page.getByTestId('ai-configure-next').click();
  await expect(page.getByTestId('ai-connect-step')).toBeVisible();
});

When('I go back a step', async ({ page }) => {
  await page.getByTestId('ai-step-back').click();
});

When('I work through configuring and connecting', async ({ page }) => {
  await openConnectorPage(page);
  await page.getByTestId('ai-configure-next').click();
  await expect(page.getByTestId('ai-connect-step')).toBeVisible();
  await page.getByTestId('ai-connect-done').click();
});

Then('the confirmation is still waiting for the assistant', async ({ page }) => {
  // Waiting rather than connected, because nothing has actually connected: the
  // wizard reaching its last step is not evidence of a live connection, and
  // this is the step that refuses to claim otherwise.
  await expect(page.getByTestId('ai-confirm-waiting')).toBeVisible();
  await expect(page.getByTestId('ai-confirm-connected')).toHaveCount(0);
});

Then('it offers to test the connection again', async ({ page }) => {
  await expect(page.getByTestId('ai-confirm-retest')).toBeVisible();
});
