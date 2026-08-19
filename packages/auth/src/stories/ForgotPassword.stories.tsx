import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { noop, refuse, storyScreens } from "./fixtures";

/**
 * "I FORGOT MY PASSWORD" — ask for a reset link.
 *
 * ## The confirmation deliberately cannot tell you whether the account exists
 *
 * Success and "no such address" produce the SAME screen, because the endpoint
 * answers the same either way. An honest "we could not find that e-mail" would
 * let anyone check who has an account here, one address at a time, with no
 * credentials at all — so the confirmation states the CONDITION ("if an account
 * exists for…") rather than implying a message definitely went out.
 */
const meta: Meta = {
  title: "Email auth/ForgotPassword",
  parameters: {
    docs: {
      description: {
        component:
          "Asks for an address and always acknowledges. The confirmation is the " +
          "same for a registered and an unregistered address — that is a security " +
          "property, not vagueness.",
      },
    },
  },
};
export default meta;

async function ask(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByTestId("forgot-email"), "ana@example.com");
  await userEvent.click(canvas.getByTestId("forgot-submit"));
}

export const Empty: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return <screens.ForgotPasswordScreen onBackToLogin={noop} />;
  },
};

/**
 * What a registered address sees. **And an unregistered one — identical.** The
 * two stories cannot be told apart, which is the design.
 */
export const LinkSent: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return <screens.ForgotPasswordScreen onBackToLogin={noop} />;
  },
  play: ({ canvasElement }) => ask(canvasElement),
};

/** Asked too many times. This one IS a refusal, because it is about the caller. */
export const RateLimited: StoryObj = {
  render: () => {
    const screens = storyScreens({
      requestPasswordReset: () => Promise.resolve(refuse("rate-limited")),
    });
    return <screens.ForgotPasswordScreen onBackToLogin={noop} />;
  },
  play: ({ canvasElement }) => ask(canvasElement),
};
