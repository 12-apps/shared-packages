import type { JSX } from "react";

import { Input } from "@12-apps/ui/form/Input";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { Text } from "@12-apps/ui/typography/Text";

import { useScreens } from "./context";
import type { SignupConfig, SignupState } from "./email-signup-form";
import { PasswordField } from "./password-field";
import { PhoneField } from "./signup-phone";

/**
 * The sign-up form's fields, one component each, so the form can put the
 * e-mail first and hold the rest back until it has a value (FUT-3806).
 */

export function NameInput({ form }: { form: SignupState }): JSX.Element {
  const { copy } = useScreens();
  return (
    <>
      <Input
        id="signup-name"
        name="name"
        label={copy.signUp.nameLabel}
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
        autoComplete="name"
        fullWidth
        data-testid="signup-name"
      />
      <Spacer size="sm" />
    </>
  );
}

export function EmailInput({ form, last }: { form: SignupState; last: boolean }): JSX.Element {
  const { copy } = useScreens();
  return (
    <>
      <Input
        id="signup-email"
        name="email"
        label={copy.signUp.emailLabel}
        type="email"
        value={form.email}
        onChange={(event) => form.setEmail(event.target.value)}
        autoComplete="email"
        fullWidth
        required
        data-testid="signup-email"
      />
      {/* Alone on its step, nothing follows it but the actions' own spacing. */}
      {last ? null : <Spacer size="sm" />}
    </>
  );
}

/** Everything after the e-mail: nome (when e-mail-first), the phone and the password. */
export function SignupDetails({ form, config }: { form: SignupState; config: SignupConfig }): JSX.Element {
  const { copy } = useScreens();
  return (
    <>
      {config.emailFirst ? <NameInput form={form} /> : null}
      {config.phone ? <PhoneField field={config.phone} phone={form.phone} /> : null}
      <PasswordField
        id="signup-password"
        label={copy.signUp.passwordLabel}
        value={form.password}
        onChange={form.setPassword}
        autoComplete="new-password"
        dataTestId="signup-password"
        error={form.passwordFailed}
        onBlur={form.leavePassword}
      />
      <Spacer size="xs" />
      <Text
        color={form.passwordFailed ? "danger" : "secondary"}
        size="sm"
        data-testid="signup-password-hint"
      >
        {copy.signUp.passwordHint}
      </Text>
    </>
  );
}
