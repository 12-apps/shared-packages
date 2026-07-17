'use client';

import { ExpandMore as ExpandMoreIcon, Search as SearchIcon } from '@mui/icons-material';
import {
  alpha,
  Box,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';

import type { SettingsLayoutProps, SettingsNavGroup, SettingsNavItem } from './SettingsLayout.types';

/** Fixed width of the left navigation rail on `md`+ screens. */
const RAIL_WIDTH = 300;

/** Case-insensitive filter over item label + keywords; drops emptied groups. */
export function filterGroups(groups: SettingsNavGroup[], query: string): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  const matches = (item: SettingsNavItem): boolean =>
    item.label.toLowerCase().includes(needle) ||
    (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle));
  return groups
    .map((group) => ({ ...group, items: group.items.filter(matches) }))
    .filter((group) => group.items.length > 0);
}

/** Label of the active item, shown in the mobile section-switcher header. */
export function activeItemLabel(
  groups: SettingsNavGroup[],
  activeItemId?: string,
): string | undefined {
  return groups.flatMap((group) => group.items).find((item) => item.id === activeItemId)?.label;
}

interface RailItemProps {
  item: SettingsNavItem;
  active: boolean;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  /** Called on activation so the mobile rail can collapse after a choice. */
  onNavigate?: () => void;
  testIdPrefix: string;
}

/** One rail entry — rendered as a link when it has `href`, else a button. */
function SettingsRailItem({
  item,
  active,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
}: RailItemProps): React.JSX.Element {
  const theme = useTheme();
  const shared = {
    selected: active,
    'aria-current': active ? ('page' as const) : undefined,
    'data-testid': `${testIdPrefix}-item-${item.id}`,
    sx: {
      borderRadius: 1.5,
      mb: 0.25,
      gap: 1.5,
      color: active ? 'primary.main' : 'text.secondary',
      '&.Mui-selected': {
        bgcolor: alpha(theme.palette.primary.main, 0.12),
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
      },
    },
  };
  const content = (
    <>
      {item.icon ? (
        <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}>{item.icon}</ListItemIcon>
      ) : null}
      <ListItemText
        primary={item.label}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: active ? 600 : 500 }}
      />
    </>
  );

  if (item.href && linkComponent) {
    const LinkComponent = linkComponent;
    return (
      <ListItemButton component={LinkComponent} href={item.href} onClick={onNavigate} {...shared}>
        {content}
      </ListItemButton>
    );
  }
  return (
    <ListItemButton
      onClick={() => {
        onSelectItem?.(item.id);
        onNavigate?.();
      }}
      {...shared}
    >
      {content}
    </ListItemButton>
  );
}

interface RailGroupProps {
  group: SettingsNavGroup;
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  onNavigate?: () => void;
  testIdPrefix: string;
}

/** A category: header + optional description + its items. */
function SettingsRailGroup({
  group,
  activeItemId,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
}: RailGroupProps): React.JSX.Element {
  return (
    <Box data-testid={`${testIdPrefix}-group-${group.id}`} sx={{ mb: 2 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          px: 1,
          color: 'text.secondary',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {group.label}
      </Typography>
      {group.description ? (
        <Typography variant="caption" component="p" sx={{ px: 1, mt: 0.25, color: 'text.disabled' }}>
          {group.description}
        </Typography>
      ) : null}
      <List disablePadding sx={{ mt: 0.5 }}>
        {group.items.map((item) => (
          <SettingsRailItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
            linkComponent={linkComponent}
            onSelectItem={onSelectItem}
            onNavigate={onNavigate}
            testIdPrefix={testIdPrefix}
          />
        ))}
      </List>
    </Box>
  );
}

interface RailToggleProps {
  title?: React.ReactNode;
  activeLabel?: string;
  open: boolean;
  onToggle: () => void;
  testIdPrefix: string;
}

/**
 * Mobile-only collapse control: shows the current section (a compact switcher)
 * so the panel content stays at the top of the screen. Hidden on `md`+.
 */
function SettingsRailToggle({
  title,
  activeLabel,
  open,
  onToggle,
  testIdPrefix,
}: RailToggleProps): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={typeof title === 'string' ? title : 'Settings'}
      data-testid={`${testIdPrefix}-toggle`}
      sx={{
        display: { xs: 'flex', md: 'none' },
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        width: '100%',
        px: 1.5,
        py: 1,
        mb: 1,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'text.primary',
        background: 'transparent',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {title ? (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {title}
          </Typography>
        ) : null}
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {activeLabel ?? ''}
        </Typography>
      </Box>
      <ExpandMoreIcon
        fontSize="small"
        sx={{
          flex: '0 0 auto',
          color: 'text.secondary',
          transition: 'transform 150ms ease',
          transform: open ? 'rotate(180deg)' : 'none',
        }}
      />
    </Box>
  );
}

interface RailBodyProps {
  navOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;
  emptySearchLabel: React.ReactNode;
  filteredGroups: SettingsNavGroup[];
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  onNavigate?: () => void;
  testIdPrefix: string;
}

/** The searchable rail body (search + groups); hidden on mobile until expanded. */
function SettingsRailBody({
  navOpen,
  query,
  onQueryChange,
  searchPlaceholder,
  emptySearchLabel,
  filteredGroups,
  activeItemId,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
}: RailBodyProps): React.JSX.Element {
  return (
    <Box
      data-testid={`${testIdPrefix}-rail-body`}
      sx={{ display: { xs: navOpen ? 'block' : 'none', md: 'block' } }}
    >
      <TextField
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={searchPlaceholder}
        size="small"
        fullWidth
        aria-label={searchPlaceholder}
        data-testid={`${testIdPrefix}-search`}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
      />
      {filteredGroups.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid={`${testIdPrefix}-empty`}
          sx={{ px: 1, py: 2 }}
        >
          {emptySearchLabel}
        </Typography>
      ) : (
        filteredGroups.map((group) => (
          <SettingsRailGroup
            key={group.id}
            group={group}
            activeItemId={activeItemId}
            linkComponent={linkComponent}
            onSelectItem={onSelectItem}
            onNavigate={onNavigate}
            testIdPrefix={testIdPrefix}
          />
        ))
      )}
    </Box>
  );
}

/** Props for {@link SettingsRail}: the rail body's inputs plus the mobile chrome. */
export type SettingsRailProps = RailBodyProps & {
  title?: React.ReactNode;
  activeLabel?: string;
  onToggleNav: () => void;
};

/** The left navigation column: desktop title, mobile switcher, and the body. */
export function SettingsRail({
  title,
  activeLabel,
  navOpen,
  onToggleNav,
  testIdPrefix,
  ...bodyProps
}: SettingsRailProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      component="nav"
      aria-label={typeof title === 'string' ? title : 'Settings'}
      data-testid={`${testIdPrefix}-rail`}
      sx={{
        flex: { xs: '0 0 auto', md: `0 0 ${RAIL_WIDTH}px` },
        width: { xs: '100%', md: RAIL_WIDTH },
        borderRight: { md: `1px solid ${theme.palette.divider}` },
        pr: { md: 2 },
      }}
    >
      {title ? (
        <Typography
          variant="h6"
          data-testid={`${testIdPrefix}-title`}
          sx={{ display: { xs: 'none', md: 'block' }, fontWeight: 700, mb: 1.5 }}
        >
          {title}
        </Typography>
      ) : null}
      <SettingsRailToggle
        title={title}
        activeLabel={activeLabel}
        open={navOpen}
        onToggle={onToggleNav}
        testIdPrefix={testIdPrefix}
      />
      <SettingsRailBody navOpen={navOpen} testIdPrefix={testIdPrefix} {...bodyProps} />
    </Box>
  );
}
