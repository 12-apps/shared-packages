import type { ConfirmActionCopy } from "../../../copy";
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type ReactNode } from 'react';

import { AlertDialog } from '../../data-display/AlertDialog';

import type {
  ConfirmInitialFocus,
  ConfirmOptions,
  ConfirmTone,
  UseConfirmActionResult,
} from './ConfirmAction.types';

const DEFAULT_TEST_ID = 'confirm-action';

/**
 * The popup's body: the row being acted on, then what happens to it.
 *
 * The NAME is rendered in its own right rather than woven into the sentence, so
 * it is there whatever the caller wrote — "the popup names the specific entity"
 * is the one thing that must not depend on each call site remembering to
 * mention it. A body with neither a name nor a description would leave the
 * operator with only the title to decide on, so a neutral fallback covers that.
 */
function confirmBody(
  description: ReactNode,
  copy: ConfirmActionCopy,
  entityName?: string,
): ReactNode {
  if (!entityName) return description ?? copy.irreversible;
  return (
    <>
      <Typography component="span" sx={{ fontWeight: 600, display: "block" }}>
        {entityName}
      </Typography>
      {description}
    </>
  );
}

/** Destructive dialogs open on Cancel; anything else opens on the confirm. */
function resolveInitialFocus(
  tone: ConfirmTone,
  initialFocus?: ConfirmInitialFocus,
): ConfirmInitialFocus {
  if (initialFocus) return initialFocus;
  return tone === 'destructive' ? 'cancel' : 'confirm';
}

/**
 * The type-to-confirm field. Rendered only when `typeToConfirm` is set, which
 * should be rare: it is the guard for actions with NO recovery path, where a
 * click is too cheap a gesture. Comparison is exact — trimmed of surrounding
 * whitespace only, so a trailing space from a paste does not read as a mismatch.
 */
function TypeToConfirmField({
  expected,
  label,
  value,
  onChange,
  disabled,
  dataTestId,
  copy,
}: {
  expected: string;
  label?: string;
  /** The words this prompt renders. REQUIRED — no default copy. */
  copy: ConfirmActionCopy;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  dataTestId: string;
}): React.ReactElement {
  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label ?? copy.typeToConfirm(expected)}
      </Typography>
      <TextField
        size="small"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        // On the INPUT rather than the wrapper: a test id on MUI's TextField
        // lands on the outer div, which is not the node a test can type into.
        inputProps={{
          'aria-label': label ?? copy.typeToConfirm(expected),
          'data-testid': `${dataTestId}-type-to-confirm`,
        }}
      />
    </Stack>
  );
}

export interface ConfirmActionDialogProps extends ConfirmOptions {
  /** The fallback body when no entity is named. REQUIRED — no default copy. */
  copy: ConfirmActionCopy;
  state: UseConfirmActionResult;
}

/**
 * The popup itself: an `AlertDialog` in its destructive skin, plus the two
 * things a bare AlertDialog has no opinion about — the failure the last attempt
 * produced (shown IN the dialog, which stays open, rather than closing over a
 * write that never landed) and the optional type-to-confirm gate.
 */
export function ConfirmActionDialog({
  state,
  title,
  description,
  entityName,
  confirmText,
  cancelText,
  typeToConfirm,
  typeToConfirmLabel,
  tone = 'destructive',
  initialFocus,
  dataTestId = DEFAULT_TEST_ID,
  copy,
}: ConfirmActionDialogProps): React.ReactElement {
  const [typed, setTyped] = React.useState('');

  // Every fresh open starts from an empty field: carrying the previous answer
  // over would hand the next delete a pre-satisfied gate.
  React.useEffect(() => {
    if (state.open) setTyped('');
  }, [state.open]);

  const gateUnmet = typeToConfirm !== undefined && typed.trim() !== typeToConfirm;

  return (
    <AlertDialog
      open={state.open}
      variant={tone === 'destructive' ? 'destructive' : 'default'}
      title={title}
      description={confirmBody(description, copy, entityName)}
      confirmText={confirmText}
      // `copy.cancel` is the fallback, NOT `AlertDialog`'s own. The 6.3.0 copy
      // sweep deleted this component's `cancelText = 'Cancelar'` default and
      // put the word in `ConfirmActionCopy` — where nothing then read it, so
      // every confirmation that names no `cancelText` of its own fell through
      // to `AlertDialog`'s English `'Cancel'`, in a pt-BR dialog. That is the
      // precise failure the sweep exists to prevent, one layer down: a port
      // that is required, supplied, and ignored.
      cancelText={cancelText ?? copy.cancel}
      loading={state.pending}
      confirmDisabled={gateUnmet}
      initialFocus={resolveInitialFocus(tone, initialFocus)}
      onConfirm={state.confirm}
      onCancel={state.cancel}
      onClose={state.cancel}
      data-testid={dataTestId}
    >
      {state.error && (
        <Alert severity="error" sx={{ mt: 1 }} data-testid={`${dataTestId}-error`}>
          {state.error}
        </Alert>
      )}
      {typeToConfirm !== undefined && (
        <TypeToConfirmField
          expected={typeToConfirm}
          label={typeToConfirmLabel}
          value={typed}
          onChange={setTyped}
          disabled={state.pending}
          dataTestId={dataTestId}
          copy={copy}
        />
      )}
    </AlertDialog>
  );
}
