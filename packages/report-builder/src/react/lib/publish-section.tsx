/**
 * Shared publish controls (FUT-307) for the report and dashboard builders:
 * lifecycle status (draft/published), the sharing rule and — for role-based
 * sharing — the tenant-role allowlist. Pure controlled component; the page
 * owns the state and the server enforces everything.
 */
import type { JSX } from "react";

import { Checkbox } from "@12-apps/ui/form/Checkbox";
import { Select } from "@12-apps/ui/form/Select";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import {
  useTenantRoles,
  type ReportStatusWire,
  type ReportVisibilityWire,
} from "../custom-reports-api";

export interface PublishDraft {
  status: ReportStatusWire;
  visibility: ReportVisibilityWire;
  visibilityRoles: string[];
}

/** The pre-FUT-307 behavior: saved documents go live for the whole team. */
export function defaultPublishDraft(): PublishDraft {
  return { status: "published", visibility: "tenant", visibilityRoles: [] };
}

const STATUS_OPTIONS: Array<{ value: ReportStatusWire; label: string }> = [
  { value: "published", label: "Publicado" },
  { value: "draft", label: "Rascunho (só você e admins)" },
];

const VISIBILITY_OPTIONS: Array<{ value: ReportVisibilityWire; label: string }> = [
  { value: "tenant", label: "Toda a equipe" },
  { value: "roles", label: "Funções específicas" },
  { value: "private", label: "Somente autor e admins" },
];

function toggleRole(roles: string[], id: string, checked: boolean): string[] {
  if (checked) return roles.includes(id) ? roles : [...roles, id];
  return roles.filter((role) => role !== id);
}

/**
 * The role allowlist, shown only for `visibility: "roles"`. Loading and
 * failure are rendered DISTINCTLY from an empty catalog — a failed roles
 * request must not look like "no roles to pick" while saving stays enabled
 * (the pre-save guard in the builders backs this up).
 */
function RolesAllowlist({
  tenantSlug,
  value,
  onChange,
}: {
  tenantSlug: string;
  value: PublishDraft;
  onChange: (next: PublishDraft) => void;
}): JSX.Element {
  const rolesQuery = useTenantRoles(tenantSlug, true);
  if (rolesQuery.isPending) {
    return (
      <Text variant="body" size="sm" color="secondary" data-testid="publish-roles-loading">
        Carregando funções…
      </Text>
    );
  }
  if (rolesQuery.isError) {
    return (
      <Text variant="body" size="sm" color="danger" data-testid="publish-roles-error">
        Não foi possível carregar as funções. Recarregue a página e tente novamente antes de
        salvar.
      </Text>
    );
  }
  const roles = rolesQuery.data;
  return (
    <Stack spacing={0.5} data-testid="publish-roles">
      <Text variant="body" size="sm" color="secondary">
        Funções com acesso (autor e admins sempre veem):
      </Text>
      {roles.length === 0 ? (
        <Text variant="body" size="sm" color="secondary">
          Nenhuma função disponível nesta loja.
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

export function PublishSection({
  tenantSlug,
  value,
  onChange,
}: {
  tenantSlug: string;
  value: PublishDraft;
  onChange: (next: PublishDraft) => void;
}): JSX.Element {
  return (
    <Stack spacing={2} data-testid="publish-section">
      <Select
        label="Status"
        options={STATUS_OPTIONS}
        value={value.status}
        onChange={(event) =>
          onChange({ ...value, status: event.target.value as ReportStatusWire })
        }
        data-testid="publish-status"
      />
      <Select
        label="Quem pode ver"
        options={VISIBILITY_OPTIONS}
        value={value.visibility}
        onChange={(event) =>
          onChange({ ...value, visibility: event.target.value as ReportVisibilityWire })
        }
        data-testid="publish-visibility"
      />
      {value.visibility === "roles" ? (
        <RolesAllowlist tenantSlug={tenantSlug} value={value} onChange={onChange} />
      ) : null}
    </Stack>
  );
}
