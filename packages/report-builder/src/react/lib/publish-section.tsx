/**
 * The publish MODEL (FUT-307) — lifecycle status, the sharing rule, and the
 * tenant-role allowlist that role-based sharing needs.
 *
 * It used to ship a `PublishSection` component too: two selects the report
 * editor rendered inline at the top of the page. GAP 8 moved those settings
 * into the *Ajustes* dialog as radio cards, where each choice can carry the
 * line that says what it means — something a `<select>` cannot do. The
 * allowlist survived the move intact and is shared from here, so there is one
 * roles control and one loading/error story rather than two.
 */
import type { JSX } from "react";

import { Checkbox } from "@12-apps/ui/form/Checkbox";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ReportStatusWire, ReportVisibilityWire } from "../custom-reports-api";
import { useTenantRoles } from "./tenant-roles";
import { useReportCopy } from "../transport-context";

export interface PublishDraft {
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  visibilityRoles: string[];
}

/**
 * What a brand-new report starts as: a private draft (FUT-755).
 *
 * It used to start PUBLISHED and visible to the whole team, which was the
 * pre-FUT-307 behaviour carried forward. Two things make that wrong now:
 *
 * 1. A report is built one block at a time, so the published default put a
 *    half-finished report in front of the store from the first keystroke.
 * 2. Editing is autosaved. A default of "published to everyone" plus "saves
 *    itself every second" is a combination nobody would choose deliberately —
 *    it broadcasts every intermediate state of a report being assembled.
 *
 * Starting private makes autosave safe by construction rather than by the
 * author remembering to change a select before they begin. Publishing is the
 * deliberate act it should have been all along, and the editor's header says
 * "Rascunho · só você" until they take it.
 */
export function defaultPublishDraft(): PublishDraft {
  return { status: "draft", visibility: "private", visibilityRoles: [] };
}

function toggleRole(roles: string[], id: string, checked: boolean): string[] {
  if (checked) return roles.includes(id) ? roles : [...roles, id];
  return roles.filter((role) => role !== id);
}

/**
 * The role allowlist, shown only for `visibility: "roles"`. Loading and
 * failure are rendered DISTINCTLY from an empty catalog — a failed roles
 * request must not look like "no roles to pick" while saving stays enabled
 * (the pre-save guard in the builders backs this up).
 *
 * Exported so the report editor's *Ajustes* dialog can offer the same list
 * under its own radio cards (GAP 8). One roles control, one loading/error
 * story — a second copy would be a second place for "failed" to look like
 * "none".
 */
export function RolesAllowlist({
  tenantSlug,
  value,
  onChange,
}: {
  tenantSlug: string;
  value: PublishDraft;
  onChange: (next: PublishDraft) => void;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const rolesQuery = useTenantRoles(tenantSlug, true);
  if (rolesQuery.isPending) {
    return (
      <Text variant="body" size="sm" color="secondary" data-testid="publish-roles-loading">
        {copy.rolesLoading}
      </Text>
    );
  }
  if (rolesQuery.isError) {
    return (
      <Text variant="body" size="sm" color="danger" data-testid="publish-roles-error">
        {copy.rolesFailed}
      </Text>
    );
  }
  const roles = rolesQuery.data;
  return (
    <Stack spacing={0.5} data-testid="publish-roles">
      <Text variant="body" size="sm" color="secondary">
        {copy.rolesHeading}
      </Text>
      {roles.length === 0 ? (
        <Text variant="body" size="sm" color="secondary">
          {copy.rolesEmpty}
        </Text>
      ) : null}
      {roles.map((role) => (
        <Checkbox
          key={role.id}
          label={role.name}
          checked={value.visibilityRoles.includes(role.id)}
          onChange={(_event, checked) =>
            onChange({
              ...value,
              visibilityRoles: toggleRole(value.visibilityRoles, role.id, checked),
            })
          }
          data-testid={`publish-role-${role.id}`}
        />
      ))}
    </Stack>
  );
}
