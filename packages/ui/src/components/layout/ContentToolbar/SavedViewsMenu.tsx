'use client';

import CheckIcon from '@mui/icons-material/Check';
import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KebabIcon from '@mui/icons-material/MoreVert';
import ViewIcon from '@mui/icons-material/Visibility';
import { Box, Button, IconButton, Menu, MenuItem, Popover, Stack, Typography } from '@mui/material';
import React, { useState } from 'react';

import type {
  SavedViewLike,
  SavedViewsLabels,
  SavedViewsMenuProps,
} from './ContentToolbar.types';

/** Default (pt-BR) strings; override any via the `labels` prop. */
const DEFAULT_LABELS: SavedViewsLabels = {
  trigger: 'Visões',
  mainView: 'Visão principal',
  pinned: 'Fixadas',
  recent: 'Recentes',
  empty: 'Nenhuma visão salva ainda.',
  saveCurrent: '+ Salvar visão atual',
  manageAll: 'Gerenciar visões',
  apply: 'Aplicar',
  setDefault: 'Definir como padrão',
  pin: 'Fixar na barra lateral',
  unpin: 'Desafixar',
  share: 'Compartilhar com a equipe',
  unshare: 'Tornar privada',
  edit: 'Editar',
  remove: 'Excluir',
  defaultTag: 'Padrão',
};

/** How many non-pinned views show under "Recentes". */
const RECENT_LIMIT = 5;

interface RowHandlers<V extends SavedViewLike> {
  apply: (view: V) => void;
  onEdit: (view: V) => void;
  onDelete: (view: V) => void;
  onSetDefault: (view: V) => void;
  onTogglePin: (view: V) => void;
  onToggleShare: (view: V) => void;
}

function DefaultTag({ label, testId }: { label: string; testId: string }): React.JSX.Element {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{ px: 0.75, py: 0.125, borderRadius: 1, fontSize: '0.7rem', bgcolor: 'primary.main', color: 'primary.contrastText' }}
    >
      {label}
    </Box>
  );
}

interface KebabAction {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/** Build the per-view ⋮ actions; owner-only mutations follow "Apply". */
function buildActions<V extends SavedViewLike>(
  view: V,
  handlers: RowHandlers<V>,
  labels: SavedViewsLabels,
): KebabAction[] {
  const actions: KebabAction[] = [{ id: 'apply', label: labels.apply, run: () => handlers.apply(view) }];
  if (!view.isOwner) return actions;
  if (!view.isDefault) {
    actions.push({ id: 'default', label: labels.setDefault, run: () => handlers.onSetDefault(view) });
  }
  actions.push({ id: 'pin', label: view.pinned ? labels.unpin : labels.pin, run: () => handlers.onTogglePin(view) });
  actions.push({ id: 'share', label: view.shared ? labels.unshare : labels.share, run: () => handlers.onToggleShare(view) });
  actions.push({ id: 'edit', label: labels.edit, run: () => handlers.onEdit(view) });
  actions.push({ id: 'delete', label: labels.remove, danger: true, run: () => handlers.onDelete(view) });
  return actions;
}

function ViewKebab<V extends SavedViewLike>({
  view,
  handlers,
  labels,
  testIdPrefix,
}: {
  view: V;
  handlers: RowHandlers<V>;
  labels: SavedViewsLabels;
  testIdPrefix: string;
}): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const close = (): void => setAnchorEl(null);
  return (
    <>
      <IconButton
        size="small"
        aria-label={`${labels.apply} ${view.name}`}
        data-testid={`${testIdPrefix}-kebab-${view.id}`}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ width: 28, height: 28, color: 'text.secondary' }}
      >
        <KebabIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        {buildActions(view, handlers, labels).map((action) => (
          <MenuItem
            key={action.id}
            data-testid={`${testIdPrefix}-item-${action.id}-${view.id}`}
            onClick={() => {
              action.run();
              close();
            }}
            sx={action.danger ? { color: 'error.main' } : undefined}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function ViewRow<V extends SavedViewLike>({
  view,
  handlers,
  labels,
  testIdPrefix,
}: {
  view: V;
  handlers: RowHandlers<V>;
  labels: SavedViewsLabels;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} data-testid={`${testIdPrefix}-row-${view.id}`}>
      <Box
        onClick={() => handlers.apply(view)}
        sx={{ flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.75 }}
        data-testid={`${testIdPrefix}-apply-${view.id}`}
      >
        <Typography component="span" sx={{ fontSize: '0.875rem' }}>
          {view.name}
        </Typography>
        {view.isDefault && <DefaultTag label={labels.defaultTag} testId={`${testIdPrefix}-default-${view.id}`} />}
      </Box>
      <ViewKebab view={view} handlers={handlers} labels={labels} testIdPrefix={testIdPrefix} />
    </Stack>
  );
}

function ViewSection<V extends SavedViewLike>({
  title,
  list,
  sectionKey,
  handlers,
  labels,
  testIdPrefix,
}: {
  title: string;
  list: V[];
  sectionKey: string;
  handlers: RowHandlers<V>;
  labels: SavedViewsLabels;
  testIdPrefix: string;
}): React.JSX.Element | null {
  if (list.length === 0) return null;
  return (
    <Box data-testid={`${testIdPrefix}-section-${sectionKey}`}>
      <Typography component="span" sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary' }}>
        {title}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {list.map((view) => (
          <ViewRow key={view.id} view={view} handlers={handlers} labels={labels} testIdPrefix={testIdPrefix} />
        ))}
      </Stack>
    </Box>
  );
}

/** A borderless footer text button (Save current / Manage all). */
function FooterButton({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Button variant="text" size="small" color="inherit" onClick={onClick} data-testid={testId} sx={{ textTransform: 'none' }}>
      {label}
    </Button>
  );
}

/** The popover contents: the built-in Main vision default, saved-view sections, and footer. */
function PopoverBody<V extends SavedViewLike>({
  views,
  pinned,
  recent,
  activeViewName,
  labels,
  handlers,
  onSelectMain,
  onSaveCurrent,
  onManageAll,
  testIdPrefix,
}: {
  views: V[];
  pinned: V[];
  recent: V[];
  activeViewName?: string;
  labels: SavedViewsLabels;
  handlers: RowHandlers<V>;
  onSelectMain: () => void;
  onSaveCurrent: () => void;
  onManageAll: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Stack spacing={1.5} sx={{ p: 1.5, width: 300 }} data-testid={`${testIdPrefix}-popover`}>
      {/* Built-in no-filter default, always available above the saved views. */}
      <MenuItem data-testid={`${testIdPrefix}-main`} selected={!activeViewName} onClick={onSelectMain} sx={{ borderRadius: 1, px: 1, gap: 1 }}>
        <Box component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.875rem' }}>
          {labels.mainView}
        </Box>
        {!activeViewName && <CheckIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
      </MenuItem>
      {views.length === 0 ? (
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{labels.empty}</Typography>
      ) : (
        <>
          <ViewSection title={labels.pinned} list={pinned} sectionKey="pinned" handlers={handlers} labels={labels} testIdPrefix={testIdPrefix} />
          <ViewSection title={labels.recent} list={recent} sectionKey="recent" handlers={handlers} labels={labels} testIdPrefix={testIdPrefix} />
        </>
      )}
      <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <FooterButton label={labels.saveCurrent} testId={`${testIdPrefix}-save-current`} onClick={onSaveCurrent} />
          <FooterButton label={labels.manageAll} testId={`${testIdPrefix}-manage-all`} onClick={onManageAll} />
        </Stack>
      </Box>
    </Stack>
  );
}

/**
 * Stateless saved-views dropdown: a neutral trigger (styled like the sibling
 * toolbar controls) that shows `activeViewName` when a view is applied, else the
 * built-in "Main vision" label. The popover lists the Main vision default plus
 * pinned + recent views; a per-view ⋮ exposes owner-only mutations. This
 * component owns NO data — every action is a callback, so a page-level Connector
 * wires it to the backend.
 */
export function SavedViewsMenu<V extends SavedViewLike = SavedViewLike>({
  views,
  activeViewName,
  onApply,
  onSelectMain,
  onSaveCurrent,
  onEdit,
  onDelete,
  onSetDefault,
  onTogglePin,
  onToggleShare,
  onManageAll,
  labels: labelOverrides,
  testIdPrefix = 'views',
}: SavedViewsMenuProps<V>): React.JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const close = (): void => setAnchorEl(null);
  const runAndClose = (action: () => void) => (): void => {
    action();
    close();
  };
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const pinned = views.filter((view) => view.pinned);
  const recent = views.filter((view) => !view.pinned).slice(0, RECENT_LIMIT);

  const handlers: RowHandlers<V> = {
    apply: (view) => {
      onApply(view);
      close();
    },
    onEdit,
    onDelete,
    onSetDefault,
    onTogglePin,
    onToggleShare,
  };

  return (
    <>
      <Button
        variant="text"
        size="small"
        color="inherit"
        onClick={(event) => setAnchorEl(event.currentTarget)}
        data-testid={`${testIdPrefix}-button`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        aria-label={activeViewName ?? labels.mainView}
        sx={{ minWidth: 0, height: 32, px: 1, gap: 0.5, color: 'text.primary', textTransform: 'none', fontWeight: 600 }}
      >
        {/* Mobile: an eye icon stands in for the view name to keep the toolbar one line. */}
        <ViewIcon sx={{ fontSize: 18, display: { xs: 'inline-flex', md: 'none' } }} />
        <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
          {activeViewName ?? labels.mainView}
        </Box>
        <ChevronDownIcon sx={{ fontSize: 14 }} />
      </Button>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <PopoverBody
          views={views}
          pinned={pinned}
          recent={recent}
          activeViewName={activeViewName}
          labels={labels}
          handlers={handlers}
          onSelectMain={runAndClose(onSelectMain)}
          onSaveCurrent={runAndClose(onSaveCurrent)}
          onManageAll={runAndClose(onManageAll)}
          testIdPrefix={testIdPrefix}
        />
      </Popover>
    </>
  );
}
