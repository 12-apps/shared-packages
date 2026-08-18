'use client';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { Box, Button, InputAdornment, TextField, Typography } from '@mui/material';
import React from 'react';

import { SettingsRailGroup, type RailShape } from './SettingsLayout.items';
import { atLeastRail, displayAcrossRail, RAIL_WIDTH, TOUCH_TARGET } from './SettingsLayout.styles';
import type {
  SettingsEmptySearchAction,
  SettingsLayoutProps,
  SettingsNavGroup,
  SettingsRailBreakpoint,
} from './SettingsLayout.types';

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

export interface RailBodyProps extends RailShape {
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
  const hidden = navOpen ? 'block' : 'none';
  return (
    <Box
      data-testid={`${testIdPrefix}-rail-body`}
      sx={(theme) =>
        shape.variant === 'drilldown'
          ? { display: 'block' }
          : displayAcrossRail(theme, shape.breakpoint, hidden, 'block')
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
  // both stay in the DOM at every width, which is what makes "the narrow width
  // offers what the wide one offers" true by construction instead of by review.
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
