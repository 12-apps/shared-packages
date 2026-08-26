'use client';

import Box from '@mui/material/Box/index.js';
import List from '@mui/material/List/index.js';
import ListItem from '@mui/material/ListItem/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { atLeastRail, TOUCH_TARGET } from './SettingsLayout.styles';
import { SettingsStatusMarker } from './SettingsStatusMarker';
import type {
  SettingsLayoutProps,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsNavVariant,
  SettingsRailBreakpoint,
} from './SettingsLayout.types';

/** The shape-deciding inputs every rail part needs to know about. */
export interface RailShape {
  variant: SettingsNavVariant;
  breakpoint: SettingsRailBreakpoint;
  atIndex: boolean;
}

interface RailItemProps extends RailShape {
  item: SettingsNavItem;
  active: boolean;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  /** Called on activation so the `switcher`'s rail can collapse after a choice. */
  onNavigate?: () => void;
  testIdPrefix: string;
}

/** Label, plus the situation marker when the host resolved one. */
function RailItemContent({
  item,
  active,
  testIdPrefix,
}: {
  item: SettingsNavItem;
  active: boolean;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <>
      {item.icon ? (
        <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}>{item.icon}</ListItemIcon>
      ) : null}
      <ListItemText
        primary={item.label}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: active ? 600 : 500 }}
      />
      {item.status ? (
        <SettingsStatusMarker
          status={item.status}
          label={item.statusLabel}
          testId={`${testIdPrefix}-status-${item.id}`}
        />
      ) : null}
    </>
  );
}

/** One rail entry — a link when it has `href`, inert text when it says so, else a button. */
export function SettingsRailItem({
  item,
  active,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
  variant,
  breakpoint,
}: RailItemProps): React.JSX.Element {
  const theme = useTheme();
  // In `drilldown` the narrow rail IS the page's list, so its rows are the
  // primary touch targets rather than a secondary column — hence the 44px floor
  // below the breakpoint. Above it, the row goes back to rail density.
  const touchFloor =
    variant === 'drilldown'
      ? { minHeight: TOUCH_TARGET, [atLeastRail(theme, breakpoint)]: { minHeight: 'auto' } }
      : null;
  const shared = {
    'data-testid': `${testIdPrefix}-item-${item.id}`,
    sx: {
      borderRadius: 1.5,
      mb: 0.25,
      gap: 1.5,
      ...touchFloor,
      color: active ? 'primary.main' : 'text.secondary',
      '&.Mui-selected': {
        bgcolor: alpha(theme.palette.primary.main, 0.12),
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
      },
    },
  };
  const content = <RailItemContent item={item} active={active} testIdPrefix={testIdPrefix} />;

  // Listed but not reachable from here. Deliberately not a disabled button: a
  // disabled control says "you may not", and the true statement is "not from
  // this screen" — the section exists and someone else's screen owns it.
  if (item.inert) {
    return (
      <ListItem {...shared} data-inert="true">
        {content}
      </ListItem>
    );
  }

  const interactive = {
    ...shared,
    selected: active,
    'aria-current': active ? ('page' as const) : undefined,
  };

  if (item.href && linkComponent) {
    const LinkComponent = linkComponent;
    return (
      <ListItemButton
        component={LinkComponent}
        href={item.href}
        onClick={onNavigate}
        {...interactive}
      >
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
      {...interactive}
    >
      {content}
    </ListItemButton>
  );
}

interface RailGroupProps extends RailShape {
  group: SettingsNavGroup;
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  onNavigate?: () => void;
  testIdPrefix: string;
}

/**
 * The list's own grid, in `drilldown` at the index only.
 *
 * At the index on a wide phone or a tablet the list has room for two columns;
 * the rail column never does, so the second column is undone at exactly the
 * width where this stops being the page.
 */
function indexListSx(shape: RailShape) {
  if (shape.variant !== 'drilldown' || !shape.atIndex) return null;
  return (theme: import('@mui/material').Theme) => ({
    display: 'grid',
    gridTemplateColumns: '1fr',
    columnGap: 8,
    [theme.breakpoints.up('sm')]: { gridTemplateColumns: '1fr 1fr' },
    [atLeastRail(theme, shape.breakpoint)]: { gridTemplateColumns: '1fr' },
  });
}

/** A category: header + optional description + its items. */
export function SettingsRailGroup({
  group,
  activeItemId,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
  ...shape
}: RailGroupProps): React.JSX.Element {
  const grid = indexListSx(shape);
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
      <List
        disablePadding
        sx={(theme) => ({ mt: 0.5, ...(grid ? grid(theme) : null) })}
      >
        {group.items.map((item) => (
          <SettingsRailItem
            key={item.id}
            item={item}
            active={item.id === activeItemId}
            linkComponent={linkComponent}
            onSelectItem={onSelectItem}
            onNavigate={onNavigate}
            testIdPrefix={testIdPrefix}
            {...shape}
          />
        ))}
      </List>
    </Box>
  );
}
