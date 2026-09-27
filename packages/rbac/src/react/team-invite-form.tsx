import { useState, type JSX } from 'react';

import { required } from '@12-apps/forms-core';
import { Alert } from '@12-apps/ui/data-display/Alert';
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

/** The values the e-mail form holds. Strings, as the container wants. */
export interface InviteFormValues extends Record<string, string> {
  email: string;
}

/**
 * What one invite asks for: an address and the roles it grants.
 *
 * The picker is ONE checklist over every role the tenant can assign — system
 * and custom alike, as many as the inviter ticks, all of them if they want —
 * exactly like the role editor an existing member opens. Person × role × tenant
 * is N×M×J; nothing about an invite ranks one role above the others.
 *
 * The wire still carries it as `role` + `customRoles`, so an invites port that
 * predates this keeps working: `role` is the first SYSTEM role ticked (absent
 * when none was), and `customRoles` is every other role ticked, of any kind.
 * A host grants all of them, additively.
 */
export interface InviteSelection {
  email: string;
  /** The first system role ticked, or undefined when every pick is custom. */
  role?: string;
  /** Every other role ticked — system or custom. May be empty. */
  customRoles: string[];
}

/** Split a ticked set into the wire's two fields, in the screen's order. */
export function toInviteSelection(
  email: string,
  picked: ReadonlySet<string>,
  systemRoles: readonly string[],
  customRoles: readonly string[],
): InviteSelection {
  const ordered = [...systemRoles, ...customRoles].filter((name) => picked.has(name));
  const role = systemRoles.find((name) => picked.has(name));
  return {
    email,
    ...(role ? { role } : {}),
    customRoles: ordered.filter((name) => name !== role),
  };
}

interface InviteFormBodyProps {
  copy: TeamScreenCopy;
  labels: RbacLabels;
  systemRoles: readonly string[];
  customRoles: readonly string[];
  /** The role ticked when the form opens. The inviter may add any others. */
  defaultRole: string;
  onSubmit: (selection: InviteSelection) => Promise<void>;
}

/**
 * The form itself. Mounted under the remount key, so BOTH halves of the
 * selection — the container's fields and the role set below — are cleared by
 * the same gesture. Holding the checkbox state a level up would leave last
 * invite's roles ticked on the next one, which is the dangerous direction: the
 * address changes and the grant silently does not.
 */
function InviteFormBody({
  copy,
  labels,
  systemRoles,
  customRoles,
  defaultRole,
  onSubmit,
}: InviteFormBodyProps): JSX.Element {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(defaultRole ? [defaultRole] : []),
  );

  const toggle = (name: string, checked: boolean): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const group = (
    title: string,
    names: readonly string[],
    labelFor: (name: string) => string,
  ): JSX.Element => (
    <div>
      <Text variant="caption" as="p" color="secondary">
        {title}
      </Text>
      <Stack>
        {names.map((name) => (
          <Checkbox
            key={name}
            label={labelFor(name)}
            checked={picked.has(name)}
            data-testid={`invite-role-opt-${name}`}
            onChange={(_event, checked) => toggle(name, checked)}
          />
        ))}
      </Stack>
    </div>
  );

  return (
    <FormContainer<InviteFormValues>
      initialValues={{ email: '' }}
      schema={{ email: [required()] }}
      onSubmit={async (values) => {
        // An invite that grants nothing is refused on screen, where the warning
        // above already says why — never posted and turned down by the server.
        if (picked.size === 0) return;
        await onSubmit(toInviteSelection(values.email, picked, systemRoles, customRoles));
      }}
      dataTestId="invite-form"
    >
      <Fields.TextField name="email" label={copy.inviteEmailLabel} />
      {group(copy.inviteRoleLabel, systemRoles, labels.roleLabel)}
      {customRoles.length > 0 &&
        group(copy.inviteCustomRolesTitle, customRoles, (name) => name)}
      {picked.size === 0 && (
        <Alert
          variant="warning"
          description={copy.inviteNoRole}
          data-testid="invite-no-role"
        />
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
 * Grant access by e-mail address, at the roles the inviter picks.
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
