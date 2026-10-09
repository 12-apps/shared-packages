import { useState, type FocusEvent, type JSX } from "react";

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
 *
 * The input and its toggle are ONE field for `onBlur`: moving between them is
 * not leaving it. Pressing the toggle does not take focus at all — the caret
 * stays in the input and a phone keeps its keyboard up — and tabbing onto it is
 * still inside. Only focus going somewhere else counts.
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
  onBlur,
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
  /** Called when focus leaves the field — the moment a typed password can be judged. */
  onBlur?: () => void;
}): JSX.Element {
  const { copy } = useScreens();
  const [visible, setVisible] = useState(false);
  const leave = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    onBlur?.();
  };
  // The toggle is the input's END ADORNMENT, so the field lays it out: centred
  // on the input's own box at every height, and the `<input>` stops short of
  // it. Positioned by hand (`top: 18`) it sat on the bottom border and the
  // input ran underneath it — drawn over each other, U2 (FUT-3475).
  const toggle = (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setVisible((current) => !current)}
      data-testid={`${dataTestId}-toggle`}
      aria-label={visible ? copy.passwordField.hideAria : copy.passwordField.showAria}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: "0.8rem",
        // A 40px tap target, the floor below 600px (`ui-quality` Q3); the
        // field's box is at least that tall, so the adornment does not grow it.
        minHeight: 40,
        padding: "0 8px",
        color: "inherit",
        opacity: 0.7,
      }}
    >
      {visible ? copy.passwordField.hide : copy.passwordField.show}
    </button>
  );
  return (
    <div onBlur={leave}>
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
        endAdornment={toggle}
        {...(error === undefined ? {} : { error })}
        {...(helperText === undefined ? {} : { helperText })}
        data-testid={dataTestId}
      />
    </div>
  );
}
