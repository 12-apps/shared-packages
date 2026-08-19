import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { storyScreens } from "./fixtures";

/**
 * THE PASSWORD INPUT, with its show/hide toggle.
 *
 * The toggle is the whole reason this is a component rather than an `<Input
 * type="password">`: every form in this flow asks somebody to type a password
 * they cannot see, and the commonest reason a correct password is refused is a
 * typo nobody can look at.
 *
 * `autoComplete` has no default on purpose — see the component. The two stories
 * that differ only by it are here to make that visible.
 */
const meta: Meta = {
  title: "Email auth/PasswordField",
  parameters: {
    docs: {
      description: {
        component:
          "A password input with a show/hide toggle. `autoComplete` is required, " +
          "because `current-password` on a sign-up form makes a password manager " +
          "fill the old one and `new-password` on a login form makes it offer to " +
          "generate a fresh one.",
      },
    },
  },
};
export default meta;

const screens = storyScreens();

/** Controlled from the outside, the way every real caller uses it. */
function Field({
  initial = "",
  autoComplete = "current-password",
  error,
  helperText,
  label = "Password",
}: {
  initial?: string;
  autoComplete?: "current-password" | "new-password";
  error?: boolean;
  helperText?: string;
  label?: string;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <screens.PasswordField
      id="story-password"
      label={label}
      value={value}
      onChange={setValue}
      autoComplete={autoComplete}
      dataTestId="story-password"
      {...(error === undefined ? {} : { error })}
      {...(helperText === undefined ? {} : { helperText })}
    />
  );
}

export const Empty: StoryObj = {
  render: () => <Field />,
};

/** Filled, and still masked — the toggle is the only way to read it back. */
export const Filled: StoryObj = {
  render: () => <Field initial="correct horse battery 9" />,
};

/**
 * The confirmation field of the reset screen, mid-typo. The error is a UI
 * concern only: the backend receives one password and has no opinion about it.
 */
export const Mismatch: StoryObj = {
  render: () => (
    <Field
      initial="correct horse battery 8"
      autoComplete="new-password"
      label="Repeat the new password"
      error
      helperText="The passwords do not match."
    />
  ),
};
