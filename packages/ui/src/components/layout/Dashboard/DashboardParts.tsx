'use client';

import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExportIcon from '@mui/icons-material/FileDownloadOutlined';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import Badge from '@mui/material/Badge/index.js';
import Box from '@mui/material/Box/index.js';
import Dialog from '@mui/material/Dialog/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import DialogTitle from '@mui/material/DialogTitle/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Menu from '@mui/material/Menu/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import Popover from '@mui/material/Popover/index.js';
import Tooltip from '@mui/material/Tooltip/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useState } from 'react';

import { HeaderActions } from '../../form/HeaderActions';
import { HeaderButton } from '../../form/HeaderButton';
import { useDashboardContext } from './DashboardContext';
import type {
  DashboardActionProps,
  DashboardActionsProps,
  DashboardExportFormat,
  DashboardExportProps,
  DashboardFilterToggleProps,
  DashboardInfoProps,
  DashboardSettingsProps,
} from './Dashboard.types';

/** Flexible spacer — everything composed after it is pushed to the right. */
export const DashboardSpacer = (): React.JSX.Element => <Box sx={{ flex: 1 }} aria-hidden />;
DashboardSpacer.displayName = 'Dashboard.Spacer';

export const DashboardInfo = ({
  title = 'About this page',
  children,
  ariaLabel = 'Page information',
}: DashboardInfoProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const open = Boolean(anchorEl);
  return (
    <>
      <Tooltip title={ariaLabel}>
        <IconButton
          size="small"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          data-testid={`${testIdPrefix}-info-trigger`}
          sx={{ color: 'text.secondary' }}
        >
          <InfoIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: '90vw' } } }}
        data-testid={`${testIdPrefix}-info-popover`}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
          <InfoIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
        </Box>
        <Box sx={{ px: 2, py: 1.5, fontSize: '0.875rem', color: 'text.secondary' }}>{children}</Box>
      </Popover>
    </>
  );
};
DashboardInfo.displayName = 'Dashboard.Info';

export const DashboardFilterToggle = ({ ariaLabel }: DashboardFilterToggleProps): React.JSX.Element => {
  const { filtersVisible, toggleFilters, activeFilterCount, testIdPrefix } = useDashboardContext();
  const label = ariaLabel ?? (filtersVisible ? 'Hide filters' : 'Show filters');
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={filtersVisible}
        onClick={toggleFilters}
        data-testid={`${testIdPrefix}-filter-toggle`}
        sx={{ color: filtersVisible ? 'primary.main' : 'text.secondary', bgcolor: filtersVisible ? 'action.selected' : 'transparent' }}
      >
        <Badge badgeContent={activeFilterCount} color="primary" overlap="circular">
          <FilterIcon fontSize="small" />
        </Badge>
      </IconButton>
    </Tooltip>
  );
};
DashboardFilterToggle.displayName = 'Dashboard.FilterToggle';

export const DashboardSettings = ({
  title = 'Settings',
  closeLabel,
  children,
  ariaLabel = 'Settings',
  href,
  linkComponent,
}: DashboardSettingsProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  const [open, setOpen] = useState(false);

  // Link mode: the gear navigates to a settings route (e.g. the page's
  // Configuração section) instead of opening an in-page dialog.
  if (href) {
    const LinkComponent = linkComponent ?? 'a';
    return (
      <Tooltip title={ariaLabel}>
        <IconButton
          size="small"
          aria-label={ariaLabel}
          component={LinkComponent}
          href={href}
          data-testid={`${testIdPrefix}-settings-trigger`}
          sx={{ color: 'text.secondary' }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip title={ariaLabel}>
        <IconButton
          size="small"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          data-testid={`${testIdPrefix}-settings-trigger`}
          sx={{ color: 'text.secondary' }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth data-testid={`${testIdPrefix}-settings-dialog`}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {title}
          <IconButton aria-label={closeLabel} size="small" onClick={() => setOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>{children}</DialogContent>
      </Dialog>
    </>
  );
};
DashboardSettings.displayName = 'Dashboard.Settings';

const DEFAULT_EXPORT_FORMATS: DashboardExportFormat[] = [
  { id: 'csv', label: 'CSV (.csv)' },
  { id: 'xlsx', label: 'Excel (.xlsx)' },
  { id: 'json', label: 'JSON (.json)' },
];

export const DashboardExport = ({
  formats = DEFAULT_EXPORT_FORMATS,
  onExport,
  label = 'Export',
}: DashboardExportProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  return (
    <>
      <HeaderButton
        variant="outlined"
        color="inherit"
        text={label}
        icon={<ExportIcon fontSize="small" />}
        endIcon={<ExpandMoreIcon fontSize="small" />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open}
        dataTestId={`${testIdPrefix}-export-trigger`}
      />
      <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)} data-testid={`${testIdPrefix}-export-menu`}>
        {formats.map((format) => (
          <MenuItem
            key={format.id}
            onClick={() => {
              onExport(format.id);
              setAnchorEl(null);
            }}
            data-testid={`${testIdPrefix}-export-${format.id}`}
          >
            {format.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
DashboardExport.displayName = 'Dashboard.Export';

export const DashboardAction = ({ children }: DashboardActionProps): React.JSX.Element => (
  <Box sx={{ display: 'inline-flex' }}>{children}</Box>
);
DashboardAction.displayName = 'Dashboard.Action';

/**
 * The header's actions, declared as a LIST — `<Dashboard.Action>`'s plural.
 *
 * `<Dashboard.Action>` is a slot: it renders whatever you hand it, once per
 * action, and a page with five of them draws five equally-loud buttons. That is
 * the right primitive for one button and the wrong one for five, and the pages
 * here that grew a fifth action all grew it the same way — by adding a fifth
 * slot, because the slot was the only thing on offer.
 *
 * This part answers the question the slot cannot: given N actions, how many
 * belong on the bar? See {@link HeaderActions} for the rule (0 ⇒ nothing,
 * 1 ⇒ a button, n ⇒ a button and a menu of the rest).
 *
 * Both stay. A header still composes `<Dashboard.Action>` for the one control
 * that is not an action at all — a link, a toggle, a status pill — and reaches
 * for this when it has actions to rank.
 */
export const DashboardActions = ({
  actions,
  moreLabel,
  collapseBelow,
}: DashboardActionsProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  return (
    <HeaderActions
      actions={actions}
      moreLabel={moreLabel}
      collapseBelow={collapseBelow}
      testIdPrefix={`${testIdPrefix}-actions`}
    />
  );
};
DashboardActions.displayName = 'Dashboard.Actions';
