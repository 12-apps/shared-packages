import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Checkbox } from '@12-apps/ui/form/Checkbox';
import { Input } from '@12-apps/ui/form/Input';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';

import { groupPermissions, sodCounterpart, type RbacLabels } from './labels';

/**
 * The role compose/edit form (12-13) — ported from the origin host's
 * `apps/admin/src/pages/roles/role-form.tsx`. Owner-marker permissions are
 * never composable; a separation-of-duties pair disables its counterpart —
 * except for a curated TEMPLATE override, whose duty pairs are intrinsic to
 * the vetted catalog (governance skips the composition guards there too).
 */

export interface RoleFormValue {
  name: string;
  description: string | null;
  permissions: string[];
}

type FormPermissions = Pick<PermissionRegistry<string>, 'list' | 'kind'>;
type FormGovernance = Pick<GovernanceCatalog, 'ownerPermissions' | 'sodPairs'>;

export interface RoleFormProps {
  permissions: FormPermissions;
  governance: FormGovernance;
  labels: RbacLabels;
  /** The role being edited, or null to compose a new one. */
  initial: RoleFormValue | null;
  /** Template-override mode: the name is fixed and SoD pairs stay enabled. */
  template?: boolean;
  busy: boolean;
  error: string | null;
  onSubmit(value: RoleFormValue): void;
  onCancel(): void;
}

/**
 * The conflict-free set a domain's "select all" grants: every permission
 * except owner-markers, and — for an SoD pair — only one side, respecting the
 * current selection, so bulk-selecting can never compose a set the server
 * would reject.
 */
function selectableTargets(
  permissions: string[],
  selected: ReadonlySet<string>,
  ownerMarkers: ReadonlySet<string>,
  governance: FormGovernance,
  sodExempt: boolean,
): string[] {
  const target: string[] = [];
  for (const permission of permissions) {
    if (ownerMarkers.has(permission)) continue;
    if (!sodExempt) {
      const counterpart = sodCounterpart(governance, permission);
      if (
        counterpart !== undefined &&
        (selected.has(counterpart) || target.includes(counterpart))
      ) {
        continue;
      }
    }
    target.push(permission);
  }
  return target;
}

interface PermissionGroupProps {
  domain: string;
  domainPermissions: string[];
  permissions: FormPermissions;
  governance: FormGovernance;
  labels: RbacLabels;
  selected: ReadonlySet<string>;
  ownerMarkers: ReadonlySet<string>;
  template: boolean;
  busy: boolean;
  onToggle: (permission: string, next: boolean) => void;
  onToggleMany: (list: string[], next: boolean) => void;
}

/** A domain's permission checkboxes under a group-level "select all" toggle. */
function PermissionGroup(props: PermissionGroupProps): JSX.Element {
  const { domain, domainPermissions, selected, ownerMarkers, template, busy } = props;
  const target = selectableTargets(
    domainPermissions,
    selected,
    ownerMarkers,
    props.governance,
    template,
  );
  const chosen = target.filter((permission) => selected.has(permission));
  const allChosen = target.length > 0 && chosen.length === target.length;
  const someChosen = chosen.length > 0 && !allChosen;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Checkbox
        label={props.labels.domainLabel(domain)}
        checked={allChosen}
        indeterminate={someChosen}
        disabled={busy || target.length === 0}
        data-testid={`perm-group-${domain}`}
        onChange={(_event, next) => props.onToggleMany(target, next)}
      />
      <Stack sx={{ pl: 3 }}>
        {domainPermissions.map((permission) => (
          <PermissionRow key={permission} permission={permission} {...props} />
        ))}
      </Stack>
    </Box>
  );
}

/** One permission checkbox with its class/instance badge. */
function PermissionRow(
  props: PermissionGroupProps & { permission: string },
): JSX.Element {
  const { permission, selected, ownerMarkers, template, busy } = props;
  const counterpart = template ? undefined : sodCounterpart(props.governance, permission);
  const sodBlocked =
    counterpart !== undefined && selected.has(counterpart) && !selected.has(permission);
  const ownerBlocked =
    ownerMarkers.has(permission) && !selected.has(permission) && !template;
  const kind = props.permissions.kind(permission);
  return (
    <Checkbox
      label={`${props.labels.permissionActionLabel(permission)} · ${
        kind === 'instance' ? 'instância' : 'classe'
      }`}
      checked={selected.has(permission)}
      disabled={busy || sodBlocked || ownerBlocked}
      data-testid={`perm-${permission}`}
      onChange={(_event, next) => props.onToggle(permission, next)}
    />
  );
}

/** The composed-set state and its two toggles, shared by group and row. */
function useSelection(initial: readonly string[]): {
  selected: Set<string>;
  toggle: (permission: string, next: boolean) => void;
  toggleMany: (list: string[], next: boolean) => void;
} {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const apply = (list: readonly string[], next: boolean): void => {
    setSelected((prev) => {
      const set = new Set(prev);
      for (const permission of list) {
        if (next) set.add(permission);
        else set.delete(permission);
      }
      return set;
    });
  };
  return {
    selected,
    toggle: (permission, next) => apply([permission], next),
    toggleMany: apply,
  };
}

/** The name + description fields. */
function RoleFormFields(props: {
  name: string;
  description: string;
  busy: boolean;
  template: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <Input
        fullWidth
        placeholder="Nome do papel"
        aria-label="Nome do papel"
        value={props.name}
        disabled={props.busy || props.template}
        data-testid="role-name"
        onChange={(event) => props.onName(event.target.value)}
      />
      <Input
        fullWidth
        placeholder="Descrição (opcional)"
        aria-label="Descrição"
        value={props.description}
        disabled={props.busy}
        data-testid="role-description"
        onChange={(event) => props.onDescription(event.target.value)}
      />
    </>
  );
}

/** The Cancelar / submit row. */
function RoleFormFooter(props: {
  editing: boolean;
  busy: boolean;
  submittable: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} justifyContent="flex-end">
      <Button variant="text" onClick={props.onCancel} disabled={props.busy} dataTestId="role-cancel">
        Cancelar
      </Button>
      <Button onClick={props.onSubmit} disabled={!props.submittable} dataTestId="role-submit">
        {props.editing ? 'Salvar' : 'Criar papel'}
      </Button>
    </Stack>
  );
}

/** The starting field values — empty for a fresh composition. */
function formDefaults(initial: RoleFormValue | null): RoleFormValue {
  return {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    permissions: initial?.permissions ?? [],
  };
}

/** The submitted payload: trimmed name, empty description folded to null. */
function toValue(name: string, description: string, selected: ReadonlySet<string>): RoleFormValue {
  const trimmedDescription = description.trim();
  return {
    name: name.trim(),
    description: trimmedDescription === '' ? null : trimmedDescription,
    permissions: [...selected],
  };
}

/** pt-BR counter: "Permissões (N selecionada(s))". */
function selectionLabel(count: number): string {
  return `Permissões (${count} selecionada${count === 1 ? '' : 's'})`;
}

export function RoleForm(props: RoleFormProps): JSX.Element {
  const { initial, template = false, busy, error } = props;
  const defaults = formDefaults(initial);
  const [name, setName] = useState(defaults.name);
  const [description, setDescription] = useState(defaults.description ?? '');
  const { selected, toggle, toggleMany } = useSelection(defaults.permissions);
  const ownerMarkers = new Set<string>(props.governance.ownerPermissions ?? []);

  return (
    <Stack spacing={2} data-testid="role-form">
      <RoleFormFields
        name={name}
        description={description}
        busy={busy}
        template={template}
        onName={setName}
        onDescription={setDescription}
      />
      <Text variant="heading" size="xs" as="p">
        {selectionLabel(selected.size)}
      </Text>
      <Box sx={{ maxHeight: 360, overflowY: 'auto', pr: 1 }}>
        {groupPermissions(props.permissions).map(({ domain, permissions }) => (
          <PermissionGroup
            key={domain}
            domain={domain}
            domainPermissions={permissions}
            permissions={props.permissions}
            governance={props.governance}
            labels={props.labels}
            selected={selected}
            ownerMarkers={ownerMarkers}
            template={template}
            busy={busy}
            onToggle={toggle}
            onToggleMany={toggleMany}
          />
        ))}
      </Box>
      {error && <Alert variant="danger" description={error} data-testid="role-form-error" />}
      <RoleFormFooter
        editing={initial !== null}
        busy={busy}
        submittable={name.trim().length > 0 && selected.size > 0 && !busy}
        onSubmit={() => props.onSubmit(toValue(name, description, selected))}
        onCancel={props.onCancel}
      />
    </Stack>
  );
}
