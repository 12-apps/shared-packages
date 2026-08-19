import type { Meta, StoryObj } from "@storybook/react-vite";

import { noop, refuse, storyScreens } from "./fixtures";

/**
 * THE PAGE THE CONFIRMATION LINK OPENS.
 *
 * All three states arrive on mount, because that is how the screen works: the
 * link opens the page and the PAGE spends the token. It is not the link itself
 * that consumes it — mail clients and corporate scanners prefetch links, and a
 * GET that consumed would be burned before the recipient ever clicked.
 */
const meta: Meta = {
  title: "Email auth/VerifyEmail",
  parameters: {
    docs: {
      description: {
        component:
          "Spends the token on mount, then says what happened. The success and " +
          "failure states differ in the button too: one continues to sign-in, the " +
          "other goes back to it.",
      },
    },
  },
};
export default meta;

/** The ordinary path: a fresh link, clicked by the person who was sent it. */
export const Confirmed: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return <screens.VerifyEmailScreen token="a-fresh-token" onContinue={noop} />;
  },
};

/** Clicked twice, or clicked a month later. */
export const Expired: StoryObj = {
  render: () => {
    const screens = storyScreens({
      verifyEmail: () => Promise.resolve(refuse("token-invalid")),
    });
    return <screens.VerifyEmailScreen token="a-spent-token" onContinue={noop} />;
  },
};

/**
 * The link arrived mangled — a mail client that wrapped the URL, most often.
 * No request is made at all: there is nothing to send.
 */
export const NoTokenInTheLink: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return <screens.VerifyEmailScreen token={null} onContinue={noop} />;
  },
};

/** The platform has the whole method switched off. */
export const MethodDisabled: StoryObj = {
  render: () => {
    const screens = storyScreens({
      verifyEmail: () => Promise.resolve(refuse("method-disabled")),
    });
    return <screens.VerifyEmailScreen token="any-token" onContinue={noop} />;
  },
};
