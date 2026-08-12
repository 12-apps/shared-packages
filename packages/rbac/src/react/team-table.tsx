import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import type { RbacLabels } from './labels';
import { RowMenu } from './team-row-menu';
import type { MemberWithRoles } from './team-role-dialog';

/**
 * The Equipe roster rows (12-13) — split from `team-screen.tsx` so the
 * screen stays within the size gate. A plain table with the same test id the
 * future-pay grid carried (`team-grid`; rows are `tr` elements the specs
 * locate by text).
 */

interface TeamTableProps {
  rows: MemberWithRoles[];
  labels: RbacLabels;
  canManage: boolean;
  /** The owner tier — rows whose disable/remove affordances are withheld. */
  ownerRoles: ReadonlySet<string>;
  onEditRoles(member: MemberWithRoles): void;
  onToggleActive(member: MemberWithRoles): void;
  onRemove(member: MemberWithRoles): void;
}

const CELL = { p: 1 } as const;

export function TeamTable(props: TeamTableProps): JSX.Element {
  const { rows, labels, canManage, ownerRoles } = props;
  return (
    <Box data-testid="team-grid" sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead">
          <Box component="tr" sx={{ textAlign: 'left' }}>
            <Box component="th" sx={CELL}>Nome</Box>
            <Box component="th" sx={CELL}>E-mail</Box>
            <Box component="th" sx={CELL}>Papéis</Box>
            <Box component="th" sx={CELL}>Status</Box>
            <Box component="th" sx={CELL} />
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((member) => (
            <Box component="tr" key={member.userId}>
              <Box component="td" sx={CELL}>{member.name ?? '—'}</Box>
              <Box component="td" sx={CELL}>{member.email}</Box>
              <Box component="td" sx={CELL}>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                  <Chip label={labels.roleLabel(member.role)} size="sm" variant="filled" />
                  {member.customRoles.map((role) => (
                    <Chip key={role} label={role} size="sm" variant="outlined" />
                  ))}
                </Stack>
              </Box>
              <Box component="td" sx={CELL}>
                {member.active ? 'Ativo' : 'Desativado'}
              </Box>
              <Box component="td" sx={CELL}>
                <RowMenu
                  member={member}
                  canManage={canManage}
                  ownerRole={ownerRoles.has(member.role)}
                  onEditRoles={() => props.onEditRoles(member)}
                  onToggleActive={() => props.onToggleActive(member)}
                  onRemove={() => props.onRemove(member)}
                />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
