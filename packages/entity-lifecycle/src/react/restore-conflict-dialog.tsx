import { useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Dialog, DialogActions, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { useTheme } from '@12-apps/ui/mui/styles';
import useMediaQuery from '@12-apps/ui/mui/useMediaQuery';
import { Text } from '@12-apps/ui/typography/Text';

import type { RestoreConflict, RestoreConflictSide, RestoreOverrides } from '../restore-conflict';

/**
 * The bin's answer to a restore the host refused for a clash (FUT-1342): the
 * row in the bin beside the live row it collides with, and one field per value
 * the person may change. Restaurar retries with what they typed; a value that
 * is still taken comes back as a fresh conflict and stays on screen, marked.
 *
 * Every sentence is the host's ({@link RestoreConflict}) except the two
 * buttons, which are the bin's own `restoreAction` and the confirmation's
 * `cancel` — this package names nobody's rows.
 *
 * A centred dialog where there is room for it and a bottom sheet on a phone —
 * the viewport decides, as it does for `@12-apps/ui`'s PickerSheet: an overlay
 * covers the viewport, so there is no container to ask. What is INSIDE the
 * dialog reflows on the dialog's own width.
 */

interface RestoreConflictDialogProps {
  conflict: RestoreConflict;
  /** Retry with the typed values; resolves to the next clash, an error, or ok. */
  onRestore: (overrides: RestoreOverrides) => Promise<RestoreAttempt>;
  onCancel: () => void;
  restoreLabel: string;
  cancelLabel: string;
}

/** What one retry came back with. */
type RestoreAttempt =
  | { ok: true }
  | { ok: false; error: string; conflict?: RestoreConflict };

/** One of the two summary cards: whose row, its name, one line about it. */
function SideCard({ side, testId }: { side: RestoreConflictSide; testId: string }): JSX.Element {
  return (
    <Box
      data-testid={testId}
      sx={{
        p: 1.5,
        minWidth: 0,
        borderRadius: 1,
        border: (theme) => `1px solid ${theme.palette.divider}`,
      }}
    >
      {/*
        Small capitals, as the approved mock draws the heading. A Box because
        Text has no transform, and `text.secondary` because Text's own
        "secondary" measured 3.24:1 on the card (WCAG AA wants 4.5:1).
      */}
      <Box
        component="p"
        sx={{
          m: 0,
          typography: 'caption',
          fontWeight: 'fontWeightMedium',
          color: 'text.secondary',
          textTransform: 'uppercase',
        }}
      >
        {side.heading}
      </Box>
      <Text variant="body" as="p" weight="semibold">
        {side.label}
      </Text>
      <Text variant="caption" as="p">
        {side.detail}
      </Text>
    </Box>
  );
}

const initialValues = (conflict: RestoreConflict): Record<string, string> =>
  Object.fromEntries(conflict.fields.map((field) => [field.key, field.value]));

/** The typed values for the fields `conflict` still asks about. */
const pick = (typed: Record<string, string>, conflict: RestoreConflict): Record<string, string> =>
  Object.fromEntries(
    conflict.fields.filter((field) => field.key in typed).map((field) => [field.key, typed[field.key] ?? '']),
  );

/** The typed values, refused before sending when a required one is blank. */
function missingRequired(conflict: RestoreConflict, values: Record<string, string>): boolean {
  return conflict.fields.some((field) => !field.optional && !(values[field.key] ?? '').trim());
}

/** The dialog's state: the latest clash, the typed values, and one retry at a time. */
function useConflictForm(
  opened: RestoreConflict,
  onRestore: RestoreConflictDialogProps['onRestore'],
) {
  const [conflict, setConflict] = useState(opened);
  const [values, setValues] = useState(() => initialValues(opened));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // After a repeated clash, focus the first field in error: the inputs were
  // disabled while the retry ran, so focus had dropped to the dialog.
  const [focusError, setFocusError] = useState(false);
  useEffect(() => {
    if (!focusError || pending) return;
    setFocusError(false);
    const invalid = conflict.fields.find((field) => field.error !== null);
    if (invalid) document.getElementById(`recycle-bin-conflict-${invalid.key}`)?.focus();
  }, [focusError, pending, conflict]);
  const blocked = missingRequired(conflict, values);

  async function submit(): Promise<void> {
    if (pending || blocked) return;
    setPending(true);
    setError(null);
    try {
      const result = await onRestore(values);
      if (result.ok) return;
      // Still taken: the host's fresh wording replaces the old one. What was
      // typed stays; a field the host adds opens with its own prefill, and one
      // it dropped is no longer sent.
      if (result.conflict) {
        const next = result.conflict;
        setConflict(next);
        setValues((typed) => ({ ...initialValues(next), ...pick(typed, next) }));
        setFocusError(true);
      } else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  const setValue = (key: string, value: string): void =>
    setValues((current) => ({ ...current, [key]: value }));
  return { conflict, values, setValue, error, pending, blocked, submit };
}

/** One input per value the host lets the person change; Enter submits. */
function ConflictFields({
  conflict,
  values,
  setValue,
  pending,
  onSubmit,
}: {
  conflict: RestoreConflict;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <Box
      component="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 1.5,
        '@container (min-width: 480px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {conflict.fields.map((field, index) => (
        <Input
          key={field.key}
          id={`recycle-bin-conflict-${field.key}`}
          label={field.label}
          value={values[field.key] ?? ''}
          onChange={(event) => setValue(field.key, event.target.value)}
          error={field.error !== null}
          helperText={field.error ?? undefined}
          // Announced, not drawn: the approved mock shows no asterisk, and the
          // dialog refuses an empty required value on its own (Restaurar off).
          inputProps={{ 'aria-required': !field.optional }}
          autoFocus={index === 0}
          disabled={pending}
          dataTestId={`recycle-bin-conflict-field-${field.key}`}
        />
      ))}
      <button type="submit" hidden tabIndex={-1} />
    </Box>
  );
}

/** Cancelar then Restaurar on a wide screen; stacked, Restaurar first, on a phone. */
function ConflictActions({
  sheet,
  form,
  onCancel,
  restoreLabel,
  cancelLabel,
}: {
  sheet: boolean;
  form: ReturnType<typeof useConflictForm>;
  onCancel: () => void;
  restoreLabel: string;
  cancelLabel: string;
}): JSX.Element {
  const restore = (
    <Button
      key="restore"
      variant="solid"
      size="lg"
      fullWidth={sheet}
      loading={form.pending}
      disabled={form.blocked}
      onClick={() => void form.submit()}
      dataTestId="recycle-bin-conflict-restore"
    >
      {restoreLabel}
    </Button>
  );
  const cancel = (
    <Button
      key="cancel"
      variant="text"
      size="lg"
      fullWidth={sheet}
      disabled={form.pending}
      onClick={onCancel}
      dataTestId="recycle-bin-conflict-cancel"
    >
      {cancelLabel}
    </Button>
  );
  return (
    <DialogActions>
      {sheet ? (
        <Stack spacing={1} sx={{ width: '100%' }}>
          {restore}
          {cancel}
        </Stack>
      ) : (
        [cancel, restore]
      )}
    </DialogActions>
  );
}

export function RestoreConflictDialog({
  conflict: opened,
  onRestore,
  onCancel,
  restoreLabel,
  cancelLabel,
}: RestoreConflictDialogProps): JSX.Element {
  const theme = useTheme();
  const sheet = useMediaQuery(theme.breakpoints.down('sm'));
  const form = useConflictForm(opened, onRestore);
  const { conflict } = form;

  return (
    <Dialog
      open
      onClose={form.pending ? undefined : onCancel}
      title={conflict.title}
      variant={sheet ? 'bottom-sheet' : 'default'}
      size="sm"
      showCloseButton={false}
      dataTestId="recycle-bin-conflict"
    >
      <DialogContent>
        <Stack spacing={2} sx={{ containerType: 'inline-size' }}>
          <Text variant="body" as="p" color="secondary" dataTestId="recycle-bin-conflict-message">
            {conflict.message}
          </Text>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
            <SideCard side={conflict.binned} testId="recycle-bin-conflict-binned" />
            <SideCard side={conflict.current} testId="recycle-bin-conflict-current" />
          </Box>
          <ConflictFields
            conflict={conflict}
            values={form.values}
            setValue={form.setValue}
            pending={form.pending}
            onSubmit={() => void form.submit()}
          />
          {form.error && (
            <Alert variant="danger" description={form.error} data-testid="recycle-bin-conflict-error" />
          )}
        </Stack>
      </DialogContent>
      <ConflictActions
        sheet={sheet}
        form={form}
        onCancel={onCancel}
        restoreLabel={restoreLabel}
        cancelLabel={cancelLabel}
      />
    </Dialog>
  );
}
