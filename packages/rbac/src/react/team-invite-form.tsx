import type { JSX } from 'react';

import { required } from '@12-apps/forms-core';
import {
  Fields,
  FormContainer,
  FormErrorSnackbar,
  SubmitButton,
} from '@12-apps/ui/form/total-form';
import { Text } from '@12-apps/ui/typography/Text';

import type { TeamScreenCopy } from './copy';

/** The values of the invite-by-email form. */
export interface InviteFormValues extends Record<string, string> {
  email: string;
}

/**
 * Grant access by e-mail address — the affordance this package shipped no way
 * to reach at all until now, despite `POST /team` existing since the roster did.
 *
 * The hint under the field is not decoration: an address WITHOUT an account
 * produces a pending invite rather than a member, and a form that did not say so
 * reads as having failed when the roster comes back unchanged.
 *
 * @param formKey Bumped by the screen after a successful submit to REMOUNT the
 * form, which is what clears the field. Resetting it in a handler would race the
 * dialog's close animation.
 */
export function TeamInviteForm({
  formKey,
  copy,
  onSubmit,
}: {
  formKey: number;
  copy: TeamScreenCopy;
  onSubmit: (values: InviteFormValues) => Promise<void>;
}): JSX.Element {
  return (
    <FormContainer<InviteFormValues>
      key={formKey}
      initialValues={{ email: '' }}
      schema={{ email: [required()] }}
      onSubmit={onSubmit}
      dataTestId="invite-form"
    >
      <Fields.TextField name="email" label={copy.inviteEmailLabel} />
      <Text variant="caption" as="span">
        {copy.inviteHint}
      </Text>
      <SubmitButton>{copy.inviteAction}</SubmitButton>
      <FormErrorSnackbar />
    </FormContainer>
  );
}
