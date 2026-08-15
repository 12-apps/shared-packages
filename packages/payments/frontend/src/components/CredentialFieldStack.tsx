'use client';

import { Stack } from '@mui/material';

import type { ProviderDescriptor } from '@12-apps/payments-backend';

import { CredentialField } from './CredentialFields';
import { saveLabel } from './credential-rules';
import { FormActions, ReverifyWarning } from './CredentialFormAlerts';
import type { CredentialFormState } from './ProviderCredentialForm';

/**
 * The live inputs for the step still owed, plus the one button that commits
 * them — and, on a store that has already proved it can receive, the warning
 * that saving will undo that.
 *
 * Its own component so `ProviderForm` stays about WHICH of the two shapes is on
 * screen (the collapsed row, or this) rather than about what each contains.
 */
export function CredentialFields({
  descriptor,
  form,
  proven,
}: {
  descriptor: ProviderDescriptor;
  form: CredentialFormState;
  /** A real charge has landed through this connection — see `ReverifyWarning`. */
  proven: boolean;
}) {
  return (
    <Stack spacing={2}>
      {proven ? <ReverifyWarning /> : null}
      {descriptor.credentialSchema.map((spec) => (
        <CredentialField
          key={spec.key}
          spec={spec}
          state={form.masked[spec.key]}
          value={form.values[spec.key]}
          // The probe's own verdict for THIS credential, keyed by the same
          // field id the adapter checked. Shown at the box rather than in a
          // list below the form, where the owner had to match four sentences
          // to four boxes by eye.
          check={form.probe?.checks?.find((entry) => entry.key === spec.key)}
          onChange={(value) => form.edit(spec.key, value)}
        />
      ))}
      <FormActions
        busy={form.busy}
        label={saveLabel(descriptor, form.complete)}
        disabled={form.nothingEdited || !form.valid}
        onSave={form.requestSave}
      />
    </Stack>
  );
}
