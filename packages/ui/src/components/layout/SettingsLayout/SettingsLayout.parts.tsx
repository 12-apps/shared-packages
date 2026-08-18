'use client';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import {
  alpha,
  Box,
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import React from 'react';

import { atLeastRail, displayAcrossRail, RAIL_WIDTH, TOUCH_TARGET } from './SettingsLayout.styles';
import { SettingsStatusMarker } from './SettingsStatusMarker';
import type {
  SettingsEmptySearchAction,
  SettingsLayoutProps,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsNavVariant,
  SettingsRailBreakpoint,
} from './SettingsLayout.types';

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

/** The shape-deciding inputs every rail part needs to know about. */
interface RailShape {
  variant: SettingsNavVariant;
  breakpoint: SettingsRailBreakpoint;
  atIndex: boolean;
}

interface RailItemProps extends RailShape {
  item: SettingsNavItem;
  active: boolean;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  /** Called on activation so the mobile rail can collapse after a choice. */
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
function SettingsRailItem({
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
      ? {
          minHeight: TOUCH_TARGET,
          [atLeastRail(theme, breakpoint)]: { minHeight: 'auto' },
        }
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
      <ListItemButton component={LinkComponent} href={item.href} onClick={onNavigate} {...interactive}>
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

/** A category: header + optional description + its items. */
function SettingsRailGroup({
  group,
  activeItemId,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
  ...shape
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
      <List
        disablePadding
        sx={(theme) => ({
          mt: 0.5,
          // At the index on a wide phone/tablet the list has room for two
          // columns; the rail column never does, so the second column is undone
          // at exactly the width where this stops being the page.
          ...(shape.variant === 'drilldown' && shape.atIndex
            ? {
                display: 'grid',
                gridTemplateColumns: '1fr',
                columnGap: 8,
                [theme.breakpoints.up('sm')]: { gridTemplateColumns: '1fr 1fr' },
                [atLeastRail(theme, shape.breakpoint)]: { gridTemplateColumns: '1fr' },
              }
            : null),
        })}
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

interface RailToggleProps {
  title?: React.ReactNode;
  activeLabel?: string;
  open: boolean;
  onToggle: () => void;
  breakpoint: SettingsRailBreakpoint;
  testIdPrefix: string;
}

/**
 * `switcher`-only collapse control: shows the current section (a compact
 * switcher) so the panel content stays at the top of the screen. Hidden once the
 * rail has its own column.
 */
function SettingsRailToggle({
  title,
  activeLabel,
  open,
  onToggle,
  breakpoint,
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
      sx={(theme) => ({
        ...displayAcrossRail(theme, breakpoint, 'flex', 'none'),
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        width: '100%',
        minHeight: TOUCH_TARGET,
        px: 1.5,
        py: 1,
        mb: 1,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'text.primary',
        background: 'transparent',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
      })}
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
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />
    </Box>
  );
}

/** The empty-search state, with the way out of it rendered inside. */
function SettingsSearchEmpty({
  label,
  action,
  onClear,
  testIdPrefix,
}: {
  label: React.ReactNode;
  action?: SettingsEmptySearchAction;
  onClear: () => void;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box data-testid={`${testIdPrefix}-empty`} sx={{ px: 1, py: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {action ? (
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            onClear();
            action.onClear?.();
          }}
          data-testid={`${testIdPrefix}-empty-action`}
          sx={{ mt: 1.5, minHeight: TOUCH_TARGET }}
        >
          {action.label}
        </Button>
      ) : null}
    </Box>
  );
}

interface RailBodyProps extends RailShape {
  navOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;
  emptySearchLabel: React.ReactNode;
  emptySearchAction?: SettingsEmptySearchAction;
  filteredGroups: SettingsNavGroup[];
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  onNavigate?: () => void;
  testIdPrefix: string;
}

/** The searchable rail body (search + groups). */
function SettingsRailBody({
  navOpen,
  query,
  onQueryChange,
  searchPlaceholder,
  emptySearchLabel,
  emptySearchAction,
  filteredGroups,
  activeItemId,
  linkComponent,
  onSelectItem,
  onNavigate,
  testIdPrefix,
  ...shape
}: RailBodyProps): React.JSX.Element {
  // `drilldown` has no disclosure to be closed behind: below the breakpoint the
  // body is the page, above it the rail. Only `switcher` hides it.
  return (
    <Box
      data-testid={`${testIdPrefix}-rail-body`}
      sx={(theme) =>
        shape.variant === 'drilldown'
          ? { display: 'block' }
          : displayAcrossRail(theme, shape.breakpoint, navOpen ? 'block' : 'none', 'block')
      }
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
        <SettingsSearchEmpty
          label={emptySearchLabel}
          action={emptySearchAction}
          onClear={() => onQueryChange('')}
          testIdPrefix={testIdPrefix}
        />
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
            {...shape}
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

/** The navigation column: title, the `switcher`'s disclosure, and the body. */
export function SettingsRail({
  title,
  activeLabel,
  navOpen,
  onToggleNav,
  testIdPrefix,
  ...bodyProps
}: SettingsRailProps): React.JSX.Element {
  const { variant, breakpoint, atIndex } = bodyProps;
  // In `drilldown` the rail is the index's list below the breakpoint and the
  // left column above it — so inside a section it steps aside for the chip
  // strip. It is `display: none`, never unmounted: the two navigation forms
  // both stay in the DOM at every width, which is what makes "the phone offers
  // what the desktop offers" true by construction instead of by review.
  const hiddenWhileInSection = variant === 'drilldown' && !atIndex;

  return (
    <Box
      component="nav"
      aria-label={typeof title === 'string' ? title : 'Settings'}
      data-testid={`${testIdPrefix}-rail`}
      sx={(theme) => ({
        display: hiddenWhileInSection ? 'none' : 'block',
        flex: '0 0 auto',
        width: '100%',
        [atLeastRail(theme, breakpoint)]: {
          display: 'block',
          flex: `0 0 ${RAIL_WIDTH}px`,
          width: RAIL_WIDTH,
          borderRight: `1px solid ${theme.palette.divider}`,
          pr: 2,
        },
      })}
    >
      {title ? (
        <Typography
          variant="h6"
          data-testid={`${testIdPrefix}-title`}
          sx={(theme) => ({
            ...(variant === 'drilldown'
              ? { display: 'block' }
              : displayAcrossRail(theme, breakpoint, 'none', 'block')),
            fontWeight: 700,
            mb: 1.5,
          })}
        >
          {title}
        </Typography>
      ) : null}
      {variant === 'switcher' ? (
        <SettingsRailToggle
          title={title}
          activeLabel={activeLabel}
          open={navOpen}
          onToggle={onToggleNav}
          breakpoint={breakpoint}
          testIdPrefix={testIdPrefix}
        />
      ) : null}
      <SettingsRailBody navOpen={navOpen} testIdPrefix={testIdPrefix} {...bodyProps} />
    </Box>
  );
}
