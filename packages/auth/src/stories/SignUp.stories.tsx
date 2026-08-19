import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { asyncNoop, fakeSession, noop, refuse, storyScreens } from "./fixtures";

/**
 * CREATE AN ACCOUNT with an e-mail and a password.
 *
 * ## The success screen has two shapes, and the difference is the platform's
 *
 * With verification REQUIRED the answer is "check your e-mail" and the person
 * cannot sign in yet. With it switched off the account works immediately, so
 * the form signs them straight in rather than making them retype a password
 * chosen ten seconds ago. The SERVER reports which happened; a screen that
 * assumed one would show the wrong message on every deployment configured the
 * other way — which is why both are stories.
 */
const meta: Meta = {
  title: "Email auth/SignUp",
  parameters: {
    docs: {
      description: {
        component:
          "Sign-up, with the two success shapes the platform switch produces. " +
          "`onBeforeSubmit` is where a host records consent — signing up with a " +
          "password is a sign-up like any other.",
      },
    },
  },
};
export default meta;

async function register(canvasElement: HTMLElement, password = "correct horse 9"): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByTestId("signup-name"), "Ana");
  await userEvent.type(canvas.getByTestId("signup-email"), "ana@example.com");
  await userEvent.type(canvas.getByTestId("signup-password"), password);
  await userEvent.click(canvas.getByTestId("signup-submit"));
}

export const Empty: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={asyncNoop}
        onSignedIn={noop}
      />
    );
  },
};

/** Verification is ON: the account exists but cannot sign in yet. */
export const VerificationSent: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={asyncNoop}
        onSignedIn={noop}
      />
    );
  },
  play: ({ canvasElement }) => register(canvasElement),
};

/**
 * **The same screen an existing address gets.** Sign-up cannot say "that
 * address is taken" while verification is on without becoming an enumeration
 * oracle — so it answers exactly as it does for a free address.
 */
export const AddressAlreadyRegistered: StoryObj = {
  render: () => {
    const screens = storyScreens();
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={asyncNoop}
        onSignedIn={noop}
      />
    );
  },
  play: ({ canvasElement }) => register(canvasElement),
};

/**
 * Verification switched OFF, so the address is free to be reported as taken —
 * the account would work immediately, so sign-up has to be able to say no.
 */
export const AddressTakenWithVerificationOff: StoryObj = {
  render: () => {
    const screens = storyScreens(
      { signUp: () => Promise.resolve(refuse("email-taken")) },
      fakeSession(),
    );
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={asyncNoop}
        onSignedIn={noop}
      />
    );
  },
  play: ({ canvasElement }) => register(canvasElement),
};

/** The policy refused it, and says every rule that was broken at once. */
export const WeakPassword: StoryObj = {
  render: () => {
    const screens = storyScreens({
      signUp: () =>
        Promise.resolve(refuse("weak-password", ["At least 8 characters.", "Include a number."])),
    });
    return (
      <screens.EmailSignupForm
        callbackUrl="/"
        onBeforeSubmit={asyncNoop}
        onSignedIn={noop}
      />
    );
  },
  play: ({ canvasElement }) => register(canvasElement, "senha"),
};
