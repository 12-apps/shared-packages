import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Spacer } from "@12-apps/ui/layout/Spacer";
import { Text } from "@12-apps/ui/typography/Text";

import type { AccountSecurityData } from "../create-email-auth";
import { useScreens } from "./context";
import type { EmailAuthScreenReason } from "./copy";
import { PasswordField } from "./password-field";
import { FailureBanner } from "./shared";

/**
 * The account's password, on a security screen — **the flow this whole feature
 * exists for**.
 *
 * Two states, and which one applies is decided by the SERVER, not by anything
 * the browser guesses:
 *
 * - **No password yet.** The account exists because somebody signed in with a
 *   social provider. There is no current password to ask for, so the form does
 *   not ask — the live session is the proof. Demanding one anyway is the
 *   obvious mistake, and it would make the feature impossible to use: the
 *   answer to "what is your current password" is "I have never had one".
 * - **Password already set.** Now it is a change, and the current one is
 *   required — otherwise a borrowed, unlocked browser is a permanent takeover
 *   rather than a temporary one.
 *
 * Adding a password does not REPLACE the social provider. Both methods stay on
 * the account, which is the point: `copy.securityCard.addIntro` is where a host
 * says so, because a person about to set one reasonably fears it will take the
 * other away.
 */

interface CardState {
  loading: boolean;
  account: AccountSecurityData | null;
  password: string;
  confirmation: string;
  currentPassword: string;
  pending: boolean;
  reason: EmailAuthScreenReason | null;
  violations: readonly string[] | null;
  saved: boolean;
  /**
   * Was the save an ADD rather than a change?
   *
   * Captured when the save succeeds, not read back off `account`: the reload
   * right after flips `hasPassword` to true, so deriving it from state would
   * tell somebody who just created their first password that it was "changed".
   */
  savedAdding: boolean;
  mismatch: boolean;
  setPassword: (value: string) => void;
  setConfirmation: (value: string) => void;
  setCurrentPassword: (value: string) => void;
  dismiss: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

function useSecurityCard(): CardState {
  const { client } = useScreens();
  const [account, setAccount] = useState<AccountSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<EmailAuthScreenReason | null>(null);
  const [violations, setViolations] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedAdding, setSavedAdding] = useState(false);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  const load = useCallback(async () => {
    const result = await client.getSecurity();
    // A refusal here means the session went away or the surface is not mounted.
    // Either way the card has nothing true to render, so it renders nothing.
    setAccount(result.ok ? result.data : null);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || mismatch) return;
    setPending(true);
    setReason(null);
    setViolations(null);
    setSaved(false);
    try {
      const result = await client.setPassword({
        password,
        ...(account?.hasPassword ? { currentPassword } : {}),
      });
      if (result.ok) {
        setSaved(true);
        setSavedAdding(!account?.hasPassword);
        setPassword("");
        setConfirmation("");
        setCurrentPassword("");
        await load();
      } else {
        setReason(result.reason);
        setViolations(result.violations ?? null);
      }
    } finally {
      setPending(false);
    }
  }

  return {
    loading,
    account,
    password,
    confirmation,
    currentPassword,
    pending,
    reason,
    violations,
    saved,
    savedAdding,
    mismatch,
    setPassword,
    setConfirmation,
    setCurrentPassword,
    dismiss: () => setReason(null),
    submit,
  };
}

/** The fields, which differ only by whether a current password is asked for. */
function PasswordForm({ card, adding }: { card: CardState; adding: boolean }): JSX.Element {
  const { copy } = useScreens();
  return (
    <form onSubmit={(event) => void card.submit(event)} data-testid="set-password-form">
      {!adding && (
        <>
          <PasswordField
            id="current-password"
            label={copy.securityCard.currentPasswordLabel}
            value={card.currentPassword}
            onChange={card.setCurrentPassword}
            autoComplete="current-password"
            dataTestId="current-password"
          />
          <Spacer size="sm" />
        </>
      )}
      <PasswordField
        id="new-password"
        label={
          adding
            ? copy.securityCard.newPasswordLabelAdd
            : copy.securityCard.newPasswordLabelChange
        }
        value={card.password}
        onChange={card.setPassword}
        autoComplete="new-password"
        dataTestId="new-password"
      />
      <Spacer size="sm" />
      <PasswordField
        id="new-password-confirm"
        label={copy.securityCard.confirmationLabel}
        value={card.confirmation}
        onChange={card.setConfirmation}
        autoComplete="new-password"
        error={card.mismatch}
        helperText={card.mismatch ? copy.securityCard.mismatch : undefined}
        dataTestId="new-password-confirm"
      />
      <Spacer size="md" />
      <Button
        type="submit"
        variant="solid"
        color="primary"
        loading={card.pending}
        disabled={
          card.pending ||
          card.password.length === 0 ||
          card.mismatch ||
          (!adding && card.currentPassword.length === 0)
        }
        dataTestId="save-password"
      >
        {adding ? copy.securityCard.submitAdd : copy.securityCard.submitChange}
      </Button>
    </form>
  );
}

export function PasswordSecurityCard(): JSX.Element | null {
  const { copy } = useScreens();
  const card = useSecurityCard();

  if (card.loading) {
    return <LoadingState variant="spinner" size="sm" dataTestId="security-loading" />;
  }
  // Nothing to offer: either the read failed, or the platform has the method
  // switched off and a password nobody could sign in with is not worth setting.
  if (!card.account?.enabled) return null;

  const adding = !card.account.hasPassword;

  return (
    // `data-mode` states which of the two situations the SERVER put this card
    // in, so a test reads it without matching the host's title copy. It is the
    // one thing about this card worth asserting portably: "add" and "change"
    // are different flows, and only the server knows which applies.
    <section data-testid="password-security-card" data-mode={adding ? "add" : "change"}>
      <Text size="lg" style={{ fontWeight: 600 }}>
        {adding ? copy.securityCard.addTitle : copy.securityCard.changeTitle}
      </Text>
      <Spacer size="xs" />
      <Text color="secondary" size="sm">
        {adding ? copy.securityCard.addIntro : copy.securityCard.changeIntro}
      </Text>
      <Spacer size="md" />

      {card.saved && (
        <>
          <Alert
            variant="success"
            title={
              card.savedAdding
                ? copy.securityCard.savedTitleAdd
                : copy.securityCard.savedTitleChange
            }
            description={copy.securityCard.savedDescription}
            data-testid="password-saved"
          />
          <Spacer size="sm" />
        </>
      )}

      <FailureBanner
        title={copy.securityCard.failureTitle}
        reason={card.reason}
        violations={card.violations}
        onDismiss={card.dismiss}
      />

      <PasswordForm card={card} adding={adding} />
    </section>
  );
}
