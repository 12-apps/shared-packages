import type { Meta, StoryObj } from "@storybook/react-vite";

import { noop, storyScreens } from "./fixtures";

/**
 * THE TWO PIECES EVERY SCREEN REACHES FOR — the refusal banner and the
 * link-shaped button.
 *
 * The banner is where the copy contract earns its keep: the screens hold no
 * sentences, so what a refusal SAYS is entirely the host's table. These stories
 * render several codes through it, which is also the cheapest way to see a
 * host's wording next to the state that triggers it.
 */
const meta: Meta = {
  title: "Email auth/Shared",
  parameters: {
    docs: {
      description: {
        component:
          "`FailureBanner` renders nothing for a null reason, so callers drop it in " +
          "unconditionally rather than wrapping it in a fragment each time. " +
          "`LinkButton` is a button that reads as a link — a real button, so it is " +
          "reachable by keyboard and announced as an action.",
      },
    },
  },
};
export default meta;

const screens = storyScreens();

export const WrongPassword: StoryObj = {
  render: () => (
    <screens.FailureBanner
      title="Could not sign you in"
      reason="invalid-credentials"
      onDismiss={noop}
    />
  ),
};

/**
 * The one refusal that carries detail: the server lists every broken rule, and
 * the banner appends them. All at once rather than one per attempt — a form
 * that reveals one requirement at a time is a guessing game.
 */
export const WeakPassword: StoryObj = {
  render: () => (
    <screens.FailureBanner
      title="Could not create the account"
      reason="weak-password"
      violations={["At least 8 characters.", "Include a number."]}
      onDismiss={noop}
    />
  ),
};

/** A code the host's table has no row for still says something. */
export const Unknown: StoryObj = {
  render: () => (
    <screens.FailureBanner title="Could not save it" reason="unknown" onDismiss={noop} />
  ),
};

/** Nothing to report renders nothing at all — not an empty box. */
export const NoFailure: StoryObj = {
  render: () => (
    <screens.FailureBanner title="Could not save it" reason={null} onDismiss={noop} />
  ),
};

export const Link: StoryObj = {
  render: () => (
    <screens.LinkButton onClick={noop} dataTestId="story-link">
      I forgot my password
    </screens.LinkButton>
  ),
};
