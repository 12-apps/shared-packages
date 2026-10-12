'use client';

import Box from '@mui/material/Box/index.js';
import List from '@mui/material/List/index.js';
import ListItem from '@mui/material/ListItem/index.js';
import ListItemButton from '@mui/material/ListItemButton/index.js';
import ListItemIcon from '@mui/material/ListItemIcon/index.js';
import ListItemText from '@mui/material/ListItemText/index.js';
import Typography from '@mui/material/Typography/index.js';
import { alpha, useTheme } from '@mui/material/styles/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import { atLeastRail, TOUCH_TARGET } from './SettingsLayout.styles';
import { rem, sxRem } from '../../../tokens/relative';
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
  /** The rail is drawn as a card (`railVariant="card"`): denser rows, darker text. */
  card?: boolean;
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

/**
 * The row's text colour. On the card the active row's red is the darker one,
 * since `primary.main` on its 12% wash measured 4.19:1 — under AA at 16px —
 * and the rest read in the body colour, as the card's prototype draws them.
 */
function railItemColor(active: boolean, card: boolean): string {
  if (active) return card ? 'primary.dark' : 'primary.main';
  return card ? 'text.primary' : 'text.secondary';
}

/**
 * Keyboard focus as a ring, not MUI's grey fill: the fill measured 1.3:1
 * against the rail, under the 3:1 a focus indicator needs.
 */
const FOCUS_RING_SX = {
  '&.Mui-focusVisible': {
    outlineStyle: 'solid',
    outlineWidth: sxRem(2),
    outlineColor: 'primary.main',
    outlineOffset: sxRem(-2),
  },
} as const;

/** The card's rows from the breakpoint up: 36px, the prototype's rail density. */
function cardRowSx(theme: Theme, breakpoint: SettingsRailBreakpoint): Record<string, unknown> {
  return { [atLeastRail(theme, breakpoint)]: { minHeight: rem(theme, 36), py: sxRem(6) } };
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
  card = false,
}: RailItemProps): React.JSX.Element {
  const theme = useTheme();
  // In `drilldown` the narrow rail IS the page's list, so its rows are the
  // primary touch targets rather than a secondary column — hence the 44px floor
  // below the breakpoint. Above it, the row goes back to rail density.
  const touchFloor =
    variant === 'drilldown'
      ? { minHeight: rem(theme, TOUCH_TARGET), [atLeastRail(theme, breakpoint)]: { minHeight: 'auto' } }
      : null;
  const shared = {
    'data-testid': `${testIdPrefix}-item-${item.id}`,
    sx: {
      borderRadius: 1.5,
      mb: 0.25,
      gap: 1.5,
      ...touchFloor,
      ...(card ? cardRowSx(theme, breakpoint) : null),
      color: railItemColor(active, card),
      '&.Mui-selected': {
        bgcolor: alpha(theme.palette.primary.main, 0.12),
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
      },
      ...FOCUS_RING_SX,
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
function indexListSx(shape: RailShape): Extract<SxProps<Theme>, (theme: Theme) => unknown> | null {
  if (shape.variant !== 'drilldown' || !shape.atIndex) return null;
  return (theme: import('@mui/material').Theme) => ({
    display: 'grid',
    gridTemplateColumns: '1fr',
    // One spacing unit (8px). This is an `sx` callback, where a bare 8 is
    // EIGHT units — it drew a 64px gutter between the two columns.
    columnGap: 1,
    // From `md`, not `sm`: at 600 two columns of bare text rows read as one
    // list with a hole in it, and a row's status dot sat nearer the next column.
    [theme.breakpoints.up('md')]: { gridTemplateColumns: '1fr 1fr' },
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
