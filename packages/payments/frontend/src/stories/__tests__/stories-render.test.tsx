// @vitest-environment jsdom
/**
 * EVERY STORY RENDERS ITS PINNED STATE, AND NONE OF THEM NEEDS A NETWORK
 * (FUT-742).
 *
 * Three claims, none of which a Storybook BUILD passing establishes:
 *
 *  1. Each story actually mounts. A build type-checks and bundles; a story that
 *     throws on its first render still ships, and is only discovered by a human
 *     clicking it.
 *  2. Each story shows THE STATE ITS DOCBLOCK PINS. "Mounts without throwing"
 *     is not that claim: the settings and checkout components catch a dead
 *     wire into an error alert, so a suite that stopped at `not.toThrow()`
 *     stayed green with the client's paths deliberately broken — every
 *     Settings story rendering the red alert instead of the page. So after the
 *     mount settles, every story must show its marker from
 *     `render-expectations.ts`: a testid or sentence that exists only when the
 *     story's own state actually rendered (a provider card, the method
 *     chooser — never the error alert, unless the error IS the story).
 *  3. No story reaches the outside world. The whole point of the story world
 *     is that a reviewer can look at every checkout state without seeding a
 *     store or running a backend — so `globalThis.fetch` is replaced here with
 *     a tripwire that FAILS the test if anything calls it. Every story is
 *     meant to talk to its own in-page mount through an injected transport,
 *     and if one silently falls back to the ambient fetch this is where that
 *     is caught.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryObj } from "@storybook/react-vite";

import * as checkoutStories from "../Checkout.stories";
import * as compositionStories from "../Composition.stories";
import * as connectionStories from "../Connection.stories";
import * as headlessStories from "../Headless.stories";
import * as hostedStories from "../Hosted.stories";
import * as legacyStories from "../Legacy.stories";
import * as platformOpsStories from "../PlatformOps.stories";
import * as priorityStories from "../Priorities.stories";
import * as providerScreenStories from "../ProviderScreens.stories";
import * as screenStories from "../Screens.stories";
import * as settingsStories from "../Settings.stories";
import * as setupGuideStories from "../SetupGuide.stories";
import * as vaultStories from "../Vault.stories";
import * as walletStories from "../Wallets.stories";
import { EXPECTATIONS, type RenderExpectation } from "./render-expectations";

/** A container, so the tripwire records into a property rather than a binding. */
const escaped: { calls: string[] } = { calls: [] };

beforeEach(() => {
  escaped.calls = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    escaped.calls.push(String(input));
    return Promise.reject(new Error("a story reached the network"));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every exported story of one module, by name. */
function storiesOf(module: Record<string, unknown>): [string, StoryObj][] {
  return Object.entries(module).filter(
    (entry): entry is [string, StoryObj] =>
      entry[0] !== "default" &&
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      "render" in entry[1],
  );
}

/** Fresh per call, so no test body shares a module-level array. */
function moduleEntries(): [string, Record<string, unknown>][] {
  return [
    ["Checkout", checkoutStories],
    ["Screens", screenStories],
    ["Vault", vaultStories],
    ["Hosted", hostedStories],
    ["Composition", compositionStories],
    ["ProviderScreens", providerScreenStories],
    ["PlatformOps", platformOpsStories],
    ["Settings", settingsStories],
    ["Connection", connectionStories],
    ["Priorities", priorityStories],
    ["SetupGuide", setupGuideStories],
    ["Wallets", walletStories],
    ["Legacy", legacyStories],
    ["Headless", headlessStories],
  ];
}

function moduleNames(): string[] {
  return moduleEntries().map(([name]) => name);
}

const MODULES = moduleEntries();

/**
 * MODULES is hand-kept while `.storybook/main.ts` discovers by glob, so the
 * two can disagree by construction — an unlisted module renders in Storybook
 * and is silently uncovered here. This test closes that hole: every
 * `*.stories.tsx` under `src/` must have a MODULES row, and every row a file.
 */
// `import.meta.glob` is Vite's, and the CALL must stay spelled literally —
// Vite's transform matches the syntax, so an alias would reach runtime
// untransformed. Only the TYPE is supplied here, because this package does
// not load `vite/client`'s ImportMeta augmentation.
declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, unknown>;
  }
}
it("MODULES covers every story module on disk", () => {
  // Compared by basename: the glob reaches ALL of src/ (as `.storybook/main.ts`
  // does), and Vite normalizes the keys' relative prefixes.
  const files = Object.keys(import.meta.glob("../../**/*.stories.@(ts|tsx)"));
  const onDisk = files.map((file) => file.split("/").pop() ?? file).sort();
  const listed = moduleNames().map((name) => `${name}.stories.tsx`).sort();
  expect(onDisk).toEqual(listed);
});

/** Is a `data-testid` on the page right now? A plain boolean, computed AFTER
 * the mount has settled — these are at-rest presence facts, not post-action
 * removal races, which is why the assertions below compare booleans. */
function hasTestId(testId: string): boolean {
  return document.querySelectorAll(`[data-testid="${testId}"]`).length > 0;
}

/** The rendered page, searched the way a reviewer reads it. */
function assertExpectation(key: string, expectation: RenderExpectation): void {
  // Whitespace-normalized, so fragments read as adjacent elements read.
  const rendered = (document.body.textContent ?? "").replace(/\s+/g, " ");
  if (expectation.empty) {
    const message = `${key}: this story pins an EMPTY render, but something is on screen`;
    expect(rendered.trim(), message).toBe("");
    return;
  }
  for (const testId of expectation.testIds ?? []) {
    const message =
      `${key}: testid "${testId}" is missing after the mount settled — the story's ` +
      `pinned state did not render (wire break, or the state drifted)`;
    expect(hasTestId(testId), message).toBe(true);
  }
  for (const fragment of expectation.text ?? []) {
    const message =
      `${key}: expected the rendered page to contain "${fragment}" — the story's ` +
      `pinned state did not render (wire break, or the copy drifted)`;
    expect(rendered.includes(fragment), message).toBe(true);
  }
  for (const testId of expectation.absentTestIds ?? []) {
    const message = `${key}: testid "${testId}" must NOT render in this story's pinned state`;
    expect(hasTestId(testId), message).toBe(false);
  }
  for (const fragment of expectation.absentText ?? []) {
    const message = `${key}: must NOT contain "${fragment}" in this story's pinned state`;
    expect(rendered.includes(fragment), message).toBe(false);
  }
}

describe.each(MODULES)("%s stories", (moduleName, module) => {
  const stories = storiesOf(module);

  it("exports at least one story", () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  it.each(stories)("%s mounts, renders its pinned state, and touches no network", async (storyName, story) => {
    const Story = story.render as () => React.ReactElement;
    // `render` throws on a component that fails, so REACHING the assertion is
    // the "it mounts" half.
    expect(() => render(<Story />)).not.toThrow();
    // Settle the microtask half of the mount inside act — in-page config
    // reads, wallet readiness probes — so the state updates they cause are
    // legal, and a fetch any of them issues still lands before the assertion.
    await act(async () => {});
    expect(escaped.calls).toEqual([]);
    // The story-specific marker: what THIS story pins, present only when the
    // in-page mount actually answered (or, for props-only stories, when the
    // pinned content rendered). A new story fails here until it declares one.
    const key = `${moduleName}/${storyName}`;
    const expectation = EXPECTATIONS[key];
    const message =
      `${key}: no render expectation — add one to render-expectations.ts naming a testid ` +
      `or sentence that only exists when this story's pinned state is on screen`;
    expect(expectation, message).toBeDefined();
    if (expectation) assertExpectation(key, expectation);
  });
});

it("render-expectations lists no story that does not exist", () => {
  const known = new Set(
    moduleEntries().flatMap(([name, module]) =>
      storiesOf(module).map(([story]) => `${name}/${story}`),
    ),
  );
  const stale = Object.keys(EXPECTATIONS).filter((key) => !known.has(key));
  expect(stale, `stale expectation keys: ${stale.join(", ")}`).toEqual([]);
});
