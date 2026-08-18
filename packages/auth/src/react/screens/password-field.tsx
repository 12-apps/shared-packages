import { useState, type JSX } from "react";

import { Input } from "@12-apps/ui/form/Input";

import { useScreens } from "./context";

/**
 * A password input with a show/hide toggle.
 *
 * The toggle is not a nicety. Every one of these forms asks somebody to type a
 * password they cannot see, twice in the reset flow and once against a policy
 * they have not read — and the most common reason a correct password is
 * rejected is a typo nobody can look at. Letting them look is the cheapest
 * possible fix.
 *
 * `autoComplete` is REQUIRED rather than defaulted, because the right value
 * differs per form and the wrong one is actively harmful: a password manager
 * told `current-password` on a sign-up form offers the old password and
 * silently fills it, and told `new-password` on a login form offers to generate
 * one. There is no value that is right everywhere, so there is no default.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  helperText,
  dataTestId,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: boolean;
  helperText?: string;
  dataTestId: string;
  autoFocus?: boolean;
}): JSX.Element {
  const { copy } = useScreens();
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Input
        id={id}
        name={id}
        label={label}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        fullWidth
        {...(error === undefined ? {} : { error })}
        {...(helperText === undefined ? {} : { helperText })}
        data-testid={dataTestId}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        data-testid={`${dataTestId}-toggle`}
        aria-label={visible ? copy.passwordField.hideAria : copy.passwordField.showAria}
        style={{
          position: "absolute",
          right: 8,
          top: 18,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "0.8rem",
          padding: "4px 8px",
          color: "inherit",
          opacity: 0.7,
        }}
      >
        {visible ? copy.passwordField.hide : copy.passwordField.show}
      </button>
    </div>
  );
}
