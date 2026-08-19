// @vitest-environment jsdom
/**
 * EVERY STORY RENDERS ITS PINNED STATE, AND NONE OF THEM NEEDS A NETWORK.
 *
 * Three claims, none of which a Storybook BUILD passing establishes:
 *
 *  1. Each story actually mounts. A build type-checks and bundles; a story that
 *     throws on its first render still ships, and is only discovered by a human
 *     clicking it.
 *  2. Each story shows THE STATE ITS DOCBLOCK PINS. "Mounts without throwing"
 *     is not that claim: every screen here catches a dead wire into a refusal
 *     banner, so a suite that stopped at `not.toThrow()` would stay green with
 *     the client's paths deliberately broken — every story rendering the same
 *     red alert. So after the mount and any `play` settle, each story must show
 *     its marker from `render-expectations.ts`.
 *  3. No story reaches the outside world. The point of the story world is that
 *     a reviewer can see every state of every screen without a backend, a
 *     database or an inbox — so `globalThis.fetch` is replaced with a tripwire
 *     that FAILS the test if anything calls it. Every screen is meant to talk
 *     to the injected client, and if one falls back to the ambient fetch this
 *     is where that is caught.
 *
 * `play` functions run here too. Several of these states — a refused sign-in, a
 * sent link, a saved password — exist only after somebody types and submits,
 * and a story catalogue that could only show empty forms would miss exactly the
 * states worth reviewing.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryObj } from "@storybook/react-vite";

import * as demoLoginPageStories from "../DemoLoginPage.stories";
import * as forgotPasswordStories from "../ForgotPassword.stories";
import * as passwordFieldStories from "../PasswordField.stories";
import * as resetPasswordStories from "../ResetPassword.stories";
import * as securityCardStories from "../SecurityCard.stories";
import * as sharedStories from "../Shared.stories";
import * as signInStories from "../SignIn.stories";
import * as signUpStories from "../SignUp.stories";
import * as verifyEmailStories from "../VerifyEmail.stories";
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
    ["PasswordField", passwordFieldStories],
    ["Shared", sharedStories],
    ["SignIn", signInStories],
    ["SignUp", signUpStories],
    ["ForgotPassword", forgotPasswordStories],
    ["ResetPassword", resetPasswordStories],
    ["VerifyEmail", verifyEmailStories],
    ["SecurityCard", securityCardStories],
    ["DemoLoginPage", demoLoginPageStories],
  ];
}

/** The names only, computed fresh — so no test body reads the shared array. */
function moduleNames(): string[] {
  return moduleEntries().map(([name]) => name);
}

const MODULES = moduleEntries();

/**
 * MODULES is hand-kept while `.storybook/main.ts` discovers by glob, so the two
 * can disagree by construction — an unlisted module renders in Storybook and is
 * silently uncovered here. This closes that hole: every `*.stories.tsx` under
 * `src/` must have a MODULES row, and every row a file.
 */
// `import.meta.glob` is Vite's, and the CALL must stay spelled literally —
// Vite's transform matches the syntax, so an alias would reach runtime
// untransformed. Only the TYPE is supplied here.
declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, unknown>;
  }
}
it("MODULES covers every story module on disk", () => {
  const files = Object.keys(import.meta.glob("../../**/*.stories.@(ts|tsx)"));
  const onDisk = files.map((file) => file.split("/").pop() ?? file).sort();
  const listed = moduleNames().map((name) => `${name}.stories.tsx`).sort();
  expect(onDisk).toEqual(listed);
});

/** Is a `data-testid` on the page right now? Computed AFTER the mount settled. */
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
      `${key}: testid "${testId}" is missing after the story settled — its pinned ` +
      `state did not render (wire break, or the state drifted)`;
    expect(hasTestId(testId), message).toBe(true);
  }
  for (const fragment of expectation.text ?? []) {
    const message =
      `${key}: expected the rendered page to contain "${fragment}" — its pinned ` +
      `state did not render (wire break, or the copy drifted)`;
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

/** The subset of a Storybook play context these stories actually read. */
interface PlayContext {
  canvasElement: HTMLElement;
}

describe.each(MODULES)("%s stories", (moduleName, module) => {
  const stories = storiesOf(module);

  it("exports at least one story", () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  it.each(stories)(
    "%s mounts, renders its pinned state, and touches no network",
    async (storyName, story) => {
      const Story = story.render as () => React.ReactElement;
      // `render` throws on a component that fails, so REACHING the next line is
      // the "it mounts" half.
      const { container } = render(<Story />);
      // Settle the microtask half of the mount — the security card's read, the
      // verification POST — so state updates they cause are legal.
      await act(async () => {});
      const play = story.play as ((context: PlayContext) => Promise<void> | void) | undefined;
      if (play) {
        await act(async () => {
          await play({ canvasElement: container });
        });
      }
      expect(escaped.calls).toEqual([]);
      const key = `${moduleName}/${storyName}`;
      const expectation = EXPECTATIONS[key];
      const message =
        `${key}: no render expectation — add one to render-expectations.ts naming a ` +
        `testid or sentence that only exists when this story's pinned state is on screen`;
      expect(expectation, message).toBeDefined();
      if (expectation) assertExpectation(key, expectation);
    },
  );
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
