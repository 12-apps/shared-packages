import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { fakeSession, noop, storyScreens } from "./fixtures";

/**
 * SIGN IN WITH AN E-MAIL AND A PASSWORD.
 *
 * Rendered above the social buttons on a login screen, and it does NOT
 * navigate: the sign-in resolves with its outcome, so a wrong password appears
 * beside the fields the person just filled in rather than through a full page
 * reload that empties them. Every failure story below is that — the form still
 * holding what was typed.
 */
const meta: Meta = {
  title: "Email auth/SignIn",
  parameters: {
    docs: {
      description: {
        component:
          "The credentials half of a login screen. Refusals render in place; the " +
          "unverified case is the one that is not merely an error, and gets an " +
          "action instead.",
      },
    },
  },
};
export default meta;

/** Fill the form and submit it, so the story shows the state after an attempt. */
async function attempt(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByTestId("login-email"), "ana@example.com");
  await userEvent.type(canvas.getByTestId("login-password"), "some password 1");
  await userEvent.click(canvas.getByTestId("login-submit"));
}

export const Empty: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.EmailPasswordForm
        callbackUrl="/"
        onSignedIn={noop}
        onForgotPassword={noop}
      />
    );
  },
};

/** The ordinary failure. Dismissable, because the fields are still filled in. */
export const WrongPassword: StoryObj = {
  render: () => {
    const screens = storyScreens({}, fakeSession({ ok: false, reason: "invalid-credentials" }));
    return (
      <screens.EmailPasswordForm
        callbackUrl="/"
        onSignedIn={noop}
        onForgotPassword={noop}
      />
    );
  },
  play: ({ canvasElement }) => attempt(canvasElement),
};

/**
 * **The password was RIGHT.** Only the address is unconfirmed, so this is a
 * warning with the one action that moves them forward — not a red error that
 * leaves somebody stuck holding correct credentials.
 */
export const AwaitingConfirmation: StoryObj = {
  render: () => {
    const screens = storyScreens({}, fakeSession({ ok: false, reason: "email-not-verified" }));
    return (
      <screens.EmailPasswordForm
        callbackUrl="/"
        onSignedIn={noop}
        onForgotPassword={noop}
      />
    );
  },
  play: ({ canvasElement }) => attempt(canvasElement),
};

/** Too many attempts. The wording is the host's; the throttle is the server's. */
export const RateLimited: StoryObj = {
  render: () => {
    const screens = storyScreens({}, fakeSession({ ok: false, reason: "rate-limited" }));
    return (
      <screens.EmailPasswordForm
        callbackUrl="/"
        onSignedIn={noop}
        onForgotPassword={noop}
      />
    );
  },
  play: ({ canvasElement }) => attempt(canvasElement),
};
