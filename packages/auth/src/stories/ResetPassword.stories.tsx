import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { noop, refuse, storyScreens } from "./fixtures";

/**
 * CHOOSE A NEW PASSWORD, using the token from the reset link.
 *
 * ## Why a rejected password leaves the link usable
 *
 * The server checks the policy BEFORE consuming the token, so the weak-password
 * story below still has a live link and the person simply tries again on this
 * same screen. Consume-then-validate would burn the link on a typo and send
 * them back to their inbox for another one.
 */
const meta: Meta = {
  title: "Email auth/ResetPassword",
  parameters: {
    docs: {
      description: {
        component:
          "Four states off one screen: the form, a link with no token in it, a " +
          "spent link, and the confirmation. The confirmation field is a UI concern " +
          "only — the backend receives one password.",
      },
    },
  },
};
export default meta;

/** Type a password twice and save it. */
async function choose(canvasElement: HTMLElement, password = "correct horse 9"): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByTestId("reset-password"), password);
  await userEvent.type(canvas.getByTestId("reset-password-confirm"), password);
  await userEvent.click(canvas.getByTestId("reset-submit"));
}

export const Form: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.ResetPasswordScreen
        token="a-fresh-token"
        onDone={noop}
        onRequestNewLink={noop}
      />
    );
  },
};

/**
 * The link arrived without its token — a mail client that wrapped the URL. The
 * screen says so instead of showing a form that would fail on submit.
 */
export const NoTokenInTheLink: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.ResetPasswordScreen token={null} onDone={noop} onRequestNewLink={noop} />
    );
  },
};

/** Clicked twice, or a day late. The only way out is a fresh link. */
export const SpentLink: StoryObj = {
  render: () => {
    const screens = storyScreens({
      resetPassword: () => Promise.resolve(refuse("token-invalid")),
    });
    return (
      <screens.ResetPasswordScreen
        token="a-spent-token"
        onDone={noop}
        onRequestNewLink={noop}
      />
    );
  },
  play: ({ canvasElement }) => choose(canvasElement),
};

/** Refused by the policy — and the link is still good, so the form stays. */
export const WeakPassword: StoryObj = {
  render: () => {
    const screens = storyScreens({
      resetPassword: () =>
        Promise.resolve(refuse("weak-password", ["At least 8 characters.", "Include a number."])),
    });
    return (
      <screens.ResetPasswordScreen
        token="a-fresh-token"
        onDone={noop}
        onRequestNewLink={noop}
      />
    );
  },
  play: ({ canvasElement }) => choose(canvasElement, "senha"),
};

export const Done: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.ResetPasswordScreen
        token="a-fresh-token"
        onDone={noop}
        onRequestNewLink={noop}
      />
    );
  },
  play: ({ canvasElement }) => choose(canvasElement),
};
