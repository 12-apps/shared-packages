import { useCallback, useEffect, useState, type JSX } from 'react';

import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { GovernanceCatalog } from '../governance';
import type { PermissionRegistry } from '../core/types';
import { useCan } from './context';

import type { RbacApiClient, RoleListRowWire } from './api';
import type { RbacLabels } from './labels';
import { RoleForm, type RoleFormValue } from './role-form';
import { RolesTable } from './roles-table';
import { SearchField } from './search-field';

/**
 * Papéis — the tenant role catalog (12-13): the seeded template roles plus
 * the tenant's custom roles, with compose/edit/override/reset/delete. Ported
 * from future-pay's `apps/admin/src/pages/roles/*`; the grid keeps the same
 * test ids (`roles-grid`, `roles-search-all`, `add-role-button`,
 * `role-dialog`) so the e2e specs moved with the screen.
 */

interface RolesScreenProps {
  api: RbacApiClient;
  permissions: Pick<PermissionRegistry<string>, 'list' | 'kind'>;
  governance: Pick<GovernanceCatalog, 'ownerPermissions' | 'sodPairs'>;
  labels: RbacLabels;
  /** The gate permission for the write affordances. */
  managePermission: string;
}

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; role: RoleListRowWire }
  | { mode: 'override'; role: RoleListRowWire };

function dialogTitle(dialog: DialogState): string {
  if (dialog.mode === 'create') return 'Novo papel';
  if (dialog.mode === 'override') return `Editar papel do sistema ${dialog.role.name}`;
  if (dialog.mode === 'edit') return `Editar ${dialog.role.name}`;
  return '';
}

function dialogInitial(dialog: DialogState): RoleFormValue | null {
  if (dialog.mode !== 'edit' && dialog.mode !== 'override') return null;
  return {
    name: dialog.role.name,
    description: dialog.role.description,
    permissions: dialog.role.permissions === '*' ? [] : [...dialog.role.permissions],
  };
}

/** The list read + refresh cycle, isolated from the screen's rendering. */
function useRolesPage(api: RbacApiClient, query: string): {
  rows: RoleListRowWire[] | null;
  loadError: string | null;
  refresh: () => void;
} {
  const [rows, setRows] = useState<RoleListRowWire[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listRoles(query ? { q: query } : {})
      .then((page) => {
        if (!cancelled) {
          setRows(page.data);
          setLoadError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar os papéis.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, query, generation]);

  return {
    rows,
    loadError,
    refresh: useCallback(() => setGeneration((value) => value + 1), []),
  };
}

/** The compose/edit dialog around {@link RoleForm}. */
function RoleFormDialog(props: {
  screen: RolesScreenProps;
  dialog: DialogState;
  busy: boolean;
  formError: string | null;
  onSubmit: (value: RoleFormValue) => void;
  onClose: () => void;
}): JSX.Element {
  const { dialog } = props;
  return (
    <Dialog
      open={dialog.mode !== 'closed'}
      onClose={props.onClose}
      title={dialogTitle(dialog)}
      size="md"
      showCloseButton
      dataTestId="role-dialog"
    >
      <DialogContent>
        {dialog.mode !== 'closed' && (
          <RoleForm
            permissions={props.screen.permissions}
            governance={props.screen.governance}
            labels={props.screen.labels}
            initial={dialogInitial(dialog)}
            template={dialog.mode === 'override'}
            busy={props.busy}
            error={props.formError}
            onSubmit={props.onSubmit}
            onCancel={props.onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RolesScreen(props: RolesScreenProps): JSX.Element {
  const { api } = props;
  const can = useCan();
  const canManage = can(props.managePermission);
  const [query, setQuery] = useState('');
  const { rows, loadError, refresh } = useRolesPage(api, query);
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const closeDialog = (): void => {
    setDialog({ mode: 'closed' });
    setFormError(null);
  };

  const submit = async (value: RoleFormValue): Promise<void> => {
    setBusy(true);
    setFormError(null);
    const result =
      dialog.mode === 'edit'
        ? await api.updateRole(dialog.role.id, value)
        : dialog.mode === 'override'
          ? await api.overrideTemplate(dialog.role.name, {
              description: value.description,
              permissions: value.permissions,
            })
          : await api.createRole(value);
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    closeDialog();
    refresh();
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Text variant="heading" size="lg" as="h1">
          Papéis
        </Text>
        {canManage && (
          <Button dataTestId="add-role-button" onClick={() => setDialog({ mode: 'create' })}>
            Novo papel
          </Button>
        )}
      </Stack>
      <SearchField placeholder="Buscar papel" testId="roles-search-all" onCommit={setQuery} />
      {loadError && <Text as="p">{loadError}</Text>}
      {rows && (
        <RolesTable
          rows={rows}
          canManage={canManage}
          onEdit={(role) =>
            setDialog(role.kind === 'SYSTEM' ? { mode: 'override', role } : { mode: 'edit', role })
          }
          onReset={(role) => {
            void api.resetTemplate(role.name).then((result) => {
              if (result.ok) refresh();
            });
          }}
          onDelete={(role) => {
            void api.deleteRole(role.id).then((result) => {
              if (result.ok) refresh();
            });
          }}
        />
      )}
      <RoleFormDialog
        screen={props}
        dialog={dialog}
        busy={busy}
        formError={formError}
        onSubmit={(value) => void submit(value)}
        onClose={closeDialog}
      />
    </Stack>
  );
}
