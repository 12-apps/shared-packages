import type { Meta, StoryObj } from "@storybook/react-vite";

import { storyScreens } from "./fixtures";

/**
 * ADD OR CHANGE A PASSWORD — **the flow this whole feature was asked for**.
 *
 * Which of the two forms renders is decided by the SERVER, on mount, and never
 * guessed in the browser. An account created through a social provider has no
 * password, so the form does not ask for a current one: the live session is the
 * proof, and the honest answer to "what is your current password" would be "I
 * have never had one".
 *
 * The two states below are the same component. That is the point — a host drops
 * one card on its settings page and does not branch.
 */
const meta: Meta = {
  title: "Email auth/SecurityCard",
  parameters: {
    docs: {
      description: {
        component:
          "Reads the account's credential state on mount and renders whichever of " +
          "'create a password' or 'change your password' applies. Renders nothing " +
          "at all when the platform has the method switched off.",
      },
    },
  },
};
export default meta;

/**
 * The Google-only account. No current-password field, and the copy says both
 * methods keep working — which is what somebody hesitating over this form is
 * actually afraid of.
 */
export const AddingTheFirstPassword: StoryObj = {
  render: () => {
    const screens = storyScreens({
      getSecurity: () =>
        Promise.resolve({
          ok: true,
          data: { hasPassword: false, emailVerified: true, enabled: true },
        }),
    });
    return <screens.PasswordSecurityCard />;
  },
};

/** Already has one, so changing it requires proving they know it. */
export const ChangingAnExistingPassword: StoryObj = {
  render: () => {
    const screens = storyScreens({
      getSecurity: () =>
        Promise.resolve({
          ok: true,
          data: { hasPassword: true, emailVerified: true, enabled: true },
        }),
    });
    return <screens.PasswordSecurityCard />;
  },
};

/**
 * The platform switch is off. The card renders NOTHING rather than offering to
 * set a password nobody could then sign in with — so this story is deliberately
 * an empty page.
 */
export const MethodSwitchedOff: StoryObj = {
  render: () => {
    const screens = storyScreens({
      getSecurity: () =>
        Promise.resolve({
          ok: true,
          data: { hasPassword: false, emailVerified: true, enabled: false },
        }),
    });
    return <screens.PasswordSecurityCard />;
  },
};
