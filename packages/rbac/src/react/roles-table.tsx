import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import type { RoleListRowWire } from './api';

/**
 * The Papéis grid rows (12-13) — split from `roles-screen.tsx` so the screen
 * stays within the size gate. A plain table with the same test ids the
 * future-pay grid carried (`roles-grid`, per-row action test ids).
 */

interface RolesTableProps {
  rows: RoleListRowWire[];
  canManage: boolean;
  onEdit(role: RoleListRowWire): void;
  onReset(role: RoleListRowWire): void;
  onDelete(role: RoleListRowWire): void;
}

const CELL = { p: 1 } as const;

function permissionCount(role: RoleListRowWire): string {
  return role.permissions === '*' ? 'todas' : String(role.permissions.length);
}

function RoleRowActions({
  role,
  onEdit,
  onReset,
  onDelete,
}: Omit<RolesTableProps, 'rows' | 'canManage'> & { role: RoleListRowWire }): JSX.Element | null {
  if (role.locked) return null;
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="text"
        size="sm"
        dataTestId={`edit-role-${role.name}`}
        onClick={() => onEdit(role)}
      >
        Editar
      </Button>
      {role.kind === 'SYSTEM' ? (
        <Button
          variant="text"
          size="sm"
          dataTestId={`reset-role-${role.name}`}
          onClick={() => onReset(role)}
        >
          Restaurar padrão
        </Button>
      ) : (
        <Button
          variant="text"
          size="sm"
          dataTestId={`delete-role-${role.name}`}
          onClick={() => onDelete(role)}
        >
          Excluir
        </Button>
      )}
    </Stack>
  );
}

export function RolesTable(props: RolesTableProps): JSX.Element {
  const { rows, canManage } = props;
  return (
    <Box data-testid="roles-grid" sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead">
          <Box component="tr" sx={{ textAlign: 'left' }}>
            <Box component="th" sx={CELL}>Nome</Box>
            <Box component="th" sx={CELL}>Descrição</Box>
            <Box component="th" sx={CELL}>Tipo</Box>
            <Box component="th" sx={CELL}>Permissões</Box>
            {canManage && <Box component="th" sx={CELL}>Ações</Box>}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((role) => (
            <Box component="tr" key={role.id} data-testid={`role-row-${role.name}`}>
              <Box component="td" sx={CELL}>{role.name}</Box>
              <Box component="td" sx={CELL}>{role.description ?? '—'}</Box>
              <Box component="td" sx={CELL}>
                <Chip
                  label={role.kind === 'SYSTEM' ? 'Sistema' : 'Personalizado'}
                  size="sm"
                  variant="filled"
                />
              </Box>
              <Box component="td" sx={CELL}>{permissionCount(role)}</Box>
              {canManage && (
                <Box component="td" sx={CELL}>
                  <RoleRowActions {...props} role={role} />
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
