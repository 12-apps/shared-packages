import { expect, type Page } from '@playwright/test';
import { defineMcpConnectWorld } from '@12-apps/mcp/e2e';

import { HARNESS_MCP_ENDPOINT } from '../../../src/pages/mcp-ai-connect-endpoint';

/**
 * THIS APP'S half of the packaged AI-connect journeys.
 *
 * The scenarios and their steps ship inside `@12-apps/mcp`; none of them is
 * copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: where the flow is mounted,
 * how to return it to a first run, and which assistant this host offers.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineMcpConnectWorld` call below
 * lands in every worker before the first Given executes.
 */

const PAGE_URL = '#/mcp-ai-connect';

defineMcpConnectWorld({
  /**
   * A fresh mount IS the reset here.
   *
   * The harness page keeps the wizard's progress in memory rather than in a
   * backend, so reloading returns it to a first run — which is what these
   * journeys need, since the landing step two of them assert only renders when
   * nothing has been saved. A real adopter resets its own store instead; that
   * difference is the host's, which is why it lives behind this port.
   */
  signInAsOwner: async (page: Page) => {
    await page.goto(PAGE_URL);
  },

  openAiIntegrationScreen: async (page: Page) => {
    await page.goto(PAGE_URL);
    await expect(page.getByTestId('ai-onboarding')).toBeVisible();
  },

  fixtures: {
    /**
     * `claude` rather than the first guide in the list, and the choice carries
     * two constraints at once: it has NO `pluginUrl`, so the flow takes the
     * manual copy → configure → connect path the scenarios walk; and it HAS a
     * `link`, which is what makes "continuing is refused until I open the
     * connector page" a real assertion. `claude-desktop` has no link (its next
     * button starts enabled) and `chatgpt` routes through per-stage steps
     * instead — neither would exercise the guard.
     */
    manualHostId: 'claude',
    endpointUrl: HARNESS_MCP_ENDPOINT,
  },
});
