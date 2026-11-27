/**
 * The close's popup: the dangerous act — what happens and what cannot be
 * undone, the reason, the tenant's name typed (the object's own name stays),
 * and the person's PIN, whose minute the server holds. The button lights only
 * when all three are given; the server asks each again.
 *
 * Centred, as it always was: the library's destructive `AlertDialog`, focus on
 * the way back, and focus returned to its opener when it closes.
 */
import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { AlertDialog } from '@12-apps/ui/data-display/AlertDialog';
import { Input } from '@12-apps/ui/form/Input';
import { Textarea } from '@12-apps/ui/form/Textarea';
import { Stack } from '@12-apps/ui/mui/Stack';

import { useClosingConfig } from './context';
import type { TenantLifecycleCopy } from './copy';
import type { TenantCloseAnswer } from './types';

/** The longest reason the close takes. */
export const REASON_MAX = 500;
/** The reason's floor, as every dangerous act asks it. */
export const REASON_MIN = 3;

/** Two spellings of the tenant's name agree, as the server compares them. */
export function nameMatches(typed: string, name: string, locale: string): boolean {
  const norm = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase(locale);
  return norm(typed) !== '' && norm(typed) === norm(name);
}

/** The message a refusal carries, or the screen's own. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface CloseDialogProps {
  name: string;
  copy: TenantLifecycleCopy;
  /** Resolves when the close landed; throws the server's sentence when it did not. */
  onConfirm: (answer: TenantCloseAnswer) => Promise<void>;
  onCancel: () => void;
}

export function CloseDialog({ name, copy, onConfirm, onCancel }: CloseDialogProps): JSX.Element {
  const config = useClosingConfig();
  const { PinFields, UndoNote } = config.components;
  const word = config.testIdWord;
  const pin = config.hooks.usePin();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = nameMatches(typed, name, config.nameLocale);
  // A name typed and wrong says so under the field: a confirm that stays off with no word is a dead end.
  const nameWrong = typed.trim() !== '' && !nameOk;
  const ready = reason.trim().length >= REASON_MIN && nameOk && pin.ready;
  const held = busy || pin.busy;

  async function confirm(): Promise<void> {
    if (!ready || !(await pin.confirm())) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim(), typedName: typed });
    } catch (failure) {
      setError(messageOf(failure, copy.actFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      closeLabel={copy.closeLabel}
      open
      variant="destructive"
      title={copy.dialogTitle}
      description={copy.dialogBody(name)}
      confirmText={copy.closeAction}
      cancelText={copy.cancel}
      loading={held}
      confirmDisabled={!ready || busy}
      initialFocus="cancel"
      onConfirm={() => void confirm()}
      onCancel={() => !held && onCancel()}
      onClose={() => !held && onCancel()}
      data-testid={`close-${word}-dialog`}
    >
      <Stack spacing={1.5}>
        <UndoNote text={copy.dialogUndo} dataTestId={`close-${word}-undo`} />
        <Textarea
          label={copy.reasonLabel}
          placeholder={copy.reasonPlaceholder}
          size="sm"
          variant="autosize"
          maxRows={4}
          maxLength={REASON_MAX}
          required
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          dataTestId={`close-${word}-reason`}
        />
        <Input
          label={copy.nameLabel}
          // The name to type, whole and wrapping, under the field: a floating label cuts it at a phone's width.
          helperText={nameWrong ? `${copy.nameMismatch} ${copy.nameHint(name)}` : copy.nameHint(name)}
          error={nameWrong}
          size="sm"
          fullWidth
          autoComplete="off"
          value={typed}
          disabled={busy}
          onChange={(event) => setTyped(event.target.value)}
          data-testid={`close-${word}-name`}
        />
        <PinFields pin={pin} />
        {error ? <Alert variant="danger" description={error} dataTestId={`close-${word}-error`} /> : null}
      </Stack>
    </AlertDialog>
  );
}
