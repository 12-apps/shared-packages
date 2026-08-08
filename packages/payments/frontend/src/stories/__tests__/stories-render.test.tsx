// @vitest-environment jsdom
/**
 * EVERY STORY RENDERS, AND NONE OF THEM NEEDS A NETWORK (FUT-742).
 *
 * Two claims, both of which a Storybook BUILD passing does not establish:
 *
 *  1. Each story actually mounts. A build type-checks and bundles; a story that
 *     throws on its first render still ships, and is only discovered by a human
 *     clicking it.
 *  2. No story reaches the outside world. The whole point of the story world is
 *     that a reviewer can look at every checkout state without seeding a store
 *     or running a backend — so `globalThis.fetch` is replaced here with a
 *     tripwire that FAILS the test if anything calls it. Every story is meant
 *     to talk to its own in-page mount through an injected transport, and if
 *     one silently falls back to the ambient fetch this is where that is caught.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryObj } from "@storybook/react-vite";

import * as checkoutStories from "../Checkout.stories";
import * as compositionStories from "../Composition.stories";
import * as hostedStories from "../Hosted.stories";
import * as platformOpsStories from "../PlatformOps.stories";
import * as providerScreenStories from "../ProviderScreens.stories";
import * as screenStories from "../Screens.stories";

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

const MODULES: [string, Record<string, unknown>][] = [
  ["Checkout", checkoutStories],
  ["Screens", screenStories],
  ["Hosted", hostedStories],
  ["Composition", compositionStories],
  ["ProviderScreens", providerScreenStories],
  ["PlatformOps", platformOpsStories],
];

describe.each(MODULES)("%s stories", (_name, module) => {
  const stories = storiesOf(module);

  it("exports at least one story", () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  it.each(stories)("%s mounts, and touches no network", (_storyName, story) => {
    const Story = story.render as () => React.ReactElement;
    // `render` throws on a component that fails, so REACHING the assertion is
    // the "it mounts" half. Rendering nothing is a legitimate outcome for at
    // least one screen — `SavedCards` deliberately draws no heading over an
    // empty list — so emptiness is not treated as a failure here.
    expect(() => render(<Story />)).not.toThrow();
    expect(escaped.calls).toEqual([]);
  });
});
