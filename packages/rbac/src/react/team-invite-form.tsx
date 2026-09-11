import { useState, type JSX } from 'react';

import { required } from '@12-apps/forms-core';
import { Checkbox } from '@12-apps/ui/form/Checkbox';
import {
  Fields,
  FormContainer,
  FormErrorSnackbar,
  SubmitButton,
} from '@12-apps/ui/form/total-form';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { TeamScreenCopy } from './copy';
import type { RbacLabels } from './labels';

/** The values the e-mail + base-role form holds. Strings, as the container wants. */
export interface InviteFormValues extends Record<string, string> {
  email: string;
  role: string;
}

/**
 * What one invite asks for: an address, the base role it grants, and any
 * additive custom roles.
 *
 * The base role is a SINGLE value rather than one entry in a set, which is the
 * one place this differs from `RoleEditDialog`'s unified checklist and is
 * deliberate. Editing an existing member starts from whatever they already
 * hold, so "exactly one system role" is a rule a selection can break and the
 * dialog warns when it does. An invite starts from nothing, so the same rule is
 * better kept by CONSTRUCTION — a control that cannot express zero or two — than
 * by a warning over a submit the person then has to fix.
 */
export interface InviteSelection {
  email: string;
  /** The system role the membership gets. Always exactly one. */
  role: string;
  /** The tenant's own roles, granted on top. May be empty. */
  customRoles: string[];
}

interface InviteFormBodyProps {
  copy: TeamScreenCopy;
  labels: RbacLabels;
  systemRoles: readonly string[];
  customRoles: readonly string[];
  defaultRole: string;
  onSubmit: (selection: InviteSelection) => Promise<void>;
}

/**
 * The form itself. Mounted under the remount key, so BOTH halves of the
 * selection — the container's fields and the custom-role set below — are
 * cleared by the same gesture. Holding the checkbox state a level up would
 * leave last invite's custom roles ticked on the next one, which is the
 * dangerous direction: the address changes and the grant silently does not.
 */
function InviteFormBody({
  copy,
  labels,
  systemRoles,
  customRoles,
  defaultRole,
  onSubmit,
}: InviteFormBodyProps): JSX.Element {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const toggle = (name: string, checked: boolean): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  return (
    <FormContainer<InviteFormValues>
      initialValues={{ email: '', role: defaultRole }}
      schema={{ email: [required()], role: [required()] }}
      onSubmit={(values) =>
        onSubmit({ email: values.email, role: values.role, customRoles: [...picked] })
      }
      dataTestId="invite-form"
    >
      <Fields.TextField name="email" label={copy.inviteEmailLabel} />
      <Fields.SelectField
        name="role"
        label={copy.inviteRoleLabel}
        options={systemRoles.map((name) => ({ value: name, label: labels.roleLabel(name) }))}
      />
      {customRoles.length > 0 && (
        <div>
          <Text variant="caption" as="p" color="secondary">
            {copy.inviteCustomRolesTitle}
          </Text>
          <Stack>
            {customRoles.map((name) => (
              <Checkbox
                key={name}
                label={name}
                checked={picked.has(name)}
                data-testid={`invite-role-opt-${name}`}
                onChange={(_event, checked) => toggle(name, checked)}
              />
            ))}
          </Stack>
        </div>
      )}
      <Text variant="caption" as="span">
        {copy.inviteHint}
      </Text>
      <SubmitButton>{copy.inviteAction}</SubmitButton>
      <FormErrorSnackbar />
    </FormContainer>
  );
}

/**
 * Grant access by e-mail address, at a role the inviter picks.
 *
 * The hint under the fields is not decoration: an address WITHOUT an account
 * produces a pending invite rather than a member, and a form that did not say so
 * reads as having failed when the roster comes back unchanged.
 *
 * @param formKey Bumped by the screen after a successful submit to REMOUNT the
 * form, which is what clears it. Resetting in a handler would race the dialog's
 * close animation.
 */
export function TeamInviteForm({
  formKey,
  ...props
}: InviteFormBodyProps & { formKey: number }): JSX.Element {
  return <InviteFormBody key={formKey} {...props} />;
}
