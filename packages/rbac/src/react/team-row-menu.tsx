import { useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';

import type { TeamMemberWire } from './api';

/**
 * The roster row's ⋮ menu (12-13) — plain ARIA roles so the surface needs no
 * menu library; a spec addresses it exactly as it addressed the future-pay
 * kebab (`team-actions-<userId>`, `menuitem` by name).
 */

interface RowMenuProps {
  member: TeamMemberWire;
  canManage: boolean;
  /** The roles protected from disable/remove (owner tier). */
  ownerRole: boolean;
  onEditRoles: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}

const ITEM_SX = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  px: 2,
  py: 1,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
} as const;

const MENU_SX = {
  position: 'absolute',
  right: 0,
  zIndex: 10,
  minWidth: 180,
  borderRadius: 1,
  boxShadow: 3,
  bgcolor: 'background.paper',
  py: 0.5,
} as const;

export function RowMenu(props: RowMenuProps): JSX.Element {
  const { member, canManage, ownerRole } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const item = (label: string, onClick: () => void): JSX.Element => (
    <Box
      component="button"
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      sx={ITEM_SX}
    >
      {label}
    </Box>
  );

  return (
    <Box ref={rootRef} sx={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="text"
        size="sm"
        dataTestId={`team-actions-${member.userId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        ⋮
      </Button>
      {open && (
        <Box role="menu" sx={MENU_SX}>
          {canManage && item('Editar papéis', props.onEditRoles)}
          {canManage &&
            !ownerRole &&
            item(member.active ? 'Desativar' : 'Ativar', props.onToggleActive)}
          {canManage && !ownerRole && item('Remover', props.onRemove)}
          {!canManage && item('Sem ações disponíveis', () => undefined)}
        </Box>
      )}
    </Box>
  );
}
