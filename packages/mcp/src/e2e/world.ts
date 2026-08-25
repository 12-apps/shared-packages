import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged AI-connect journeys.
 *
 * These journeys were written because the walkthrough they cover was tested
 * NOWHERE. `./react` ships the whole flow — the landing, the assistant picker,
 * the endpoint to copy, the configure and connect steps, the confirmation and
 * its re-test — and twenty test ids go with it. Not one of them appeared in
 * this package's own suite, and not one appeared in the origin host's specs
 * either: that host's `ai.e2e.ts` drives its OWN plan lock and upsell modal,
 * reaching only `ai-onboarding` and the status board on the way past.
 *
 * So the flow a store owner actually walks was covered by nothing, in either
 * repo. That is the gap the `e2e` capability exists to convert into a
 * declaration rather than an omission nobody can see.
 *
 * What stays the host's: how it signs an owner in, where it mounts the flow,
 * and which assistant its `hosts` config offers — the guides are REQUIRED
 * config (FUT-760), so the package has no assistant of its own to name.
 */

/** Facts about the host that the assertions have to name. */
export interface McpConnectFixtures {
  /**
   * The id of an assistant the host offers whose guide has NO `pluginUrl`.
   *
   * The flow BRANCHES on that field: a guide carrying one gets `InstallStep`
   * (a single "open the install link" button), and a guide without one gets
   * the three-step manual path — copy the endpoint, configure, connect. These
   * journeys walk the MANUAL path, so the host has to point at a guide that
   * takes it. Naming the branch here rather than guessing keeps the scenario
   * from failing in a host whose first assistant happens to ship a plugin.
   */
  manualHostId: string;
  /** The endpoint URL that host serves, as it is rendered for copying. */
  endpointUrl: string;
}

/** What a host must be able to do for these journeys to run in it. */
export interface McpConnectWorld {
  /**
   * Put the browser in a known signed-in state as somebody who may connect an
   * assistant, with the flow's progress RESET to its first run.
   *
   * The reset is load-bearing rather than hygiene: the wizard persists its step
   * through `@12-apps/onboarding`, so a scenario that advanced it would hand
   * the next one a flow resuming from the middle — and the landing step, which
   * two of these scenarios assert, would never render.
   */
  signInAsOwner(page: Page): Promise<void>;
  /** Land on the screen that mounts `AiIntegrationOnboarding`. */
  openAiIntegrationScreen(page: Page): Promise<void>;
  fixtures: McpConnectFixtures;
}

let installed: McpConnectWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineMcpConnectWorld(world: McpConnectWorld): void {
  installed = world;
}

/**
 * The installed world, or a refusal naming the fix.
 *
 * Throws rather than returning null: a step that ran against an absent world
 * would fail on whatever it touched next, somewhere unrelated to the actual
 * mistake, which is a diagnosis nobody should have to make twice.
 */
export function mcpConnectWorld(): McpConnectWorld {
  if (!installed) {
    throw new Error(
      'No mcp e2e world is installed. Call defineMcpConnectWorld({ … }) from a module inside ' +
        "your own `steps` glob — playwright-bdd imports those before any scenario runs, " +
        'which is what makes the registration land in every worker.',
    );
  }
  return installed;
}
