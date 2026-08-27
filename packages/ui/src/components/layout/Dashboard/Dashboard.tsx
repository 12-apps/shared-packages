'use client';

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FilterIcon from '@mui/icons-material/FilterListRounded';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import Box from '@mui/material/Box/index.js';
import MuiBreadcrumbs from '@mui/material/Breadcrumbs/index.js';
import Button from '@mui/material/Button/index.js';
import Collapse from '@mui/material/Collapse/index.js';
import MuiLink from '@mui/material/Link/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled } from '@mui/material/styles/index.js';
import React, { useMemo, useState } from 'react';

import { DashboardContext, useDashboardContext } from './DashboardContext';
import {
  DashboardAction,
  DashboardActions,
  DashboardExport,
  DashboardFilterToggle,
  DashboardInfo,
  DashboardSettings,
  DashboardSpacer,
} from './DashboardParts';
import type {
  DashboardBodyProps,
  DashboardBreadcrumbProps,
  DashboardFiltersProps,
  DashboardHeaderProps,
  DashboardMoreFiltersProps,
  DashboardProps,
} from './Dashboard.types';

/**
 * Ordered slot keys. The root reorders composed children into this sequence so
 * authoring order in JSX never matters — a `<Dashboard.Filters>` placed above
 * a `<Dashboard.Header>` still renders below it.
 */
const SLOT_ORDER = ['breadcrumb', 'header', 'filters', 'body'] as const;
/** A slot a component can occupy in the canonical Dashboard order. */
export type DashboardSlot = (typeof SLOT_ORDER)[number];

/** Marker attached to each sub-component so the root can rank it by slot. */
type SlottedComponent = { dashboardSlot?: DashboardSlot };

/**
 * Tag a component with the Dashboard slot it occupies so the root ranks it in
 * canonical order. The root inspects only its DIRECT children's `type`, so a
 * page that wraps a `<Dashboard.Header>` (or any part) in its own component MUST
 * mark that wrapper — otherwise it counts as an unrecognised child and sinks
 * below the body. Returns the component for convenient inline use.
 *
 * @example
 * ```tsx
 * function ProductsHeader(props) {
 *   return <Dashboard.Header title="Products">{/* … *\/}</Dashboard.Header>;
 * }
 * markDashboardSlot(ProductsHeader, 'header');
 * ```
 */
export function markDashboardSlot<T>(component: T, slot: DashboardSlot): T {
  (component as SlottedComponent).dashboardSlot = slot;
  return component;
}

const Root = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
  width: '100%',
}));

function slotRank(node: React.ReactNode): number {
  if (React.isValidElement(node)) {
    const slot = (node.type as SlottedComponent).dashboardSlot;
    if (slot) {
      const rank = SLOT_ORDER.indexOf(slot);
      if (rank >= 0) {
        return rank;
      }
    }
  }
  // Unknown / arbitrary children keep their relative position after the
  // recognised slots.
  return SLOT_ORDER.length;
}

/**
 * Composable page shell. `<Dashboard>` provides shared state through context
 * and renders whichever sub-components you compose — nothing is implied. Drop
 * in only the parts you need; omit `<Dashboard.Filters>` and there is simply no
 * filter UI.
 *
 * @example
 * ```tsx
 * <Dashboard activeFilterCount={2}>
 *   <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Products' }]} />
 *   <Dashboard.Header title="Products">
 *     <Dashboard.Info>What this page does…</Dashboard.Info>
 *     <Dashboard.FilterToggle />
 *     <Dashboard.Settings>In development</Dashboard.Settings>
 *     <Dashboard.Spacer />
 *     <Dashboard.Export onExport={handleExport} />
 *     <Dashboard.Action><Button variant="contained">New product</Button></Dashboard.Action>
 *   </Dashboard.Header>
 *   <Dashboard.Filters>{/* search + pills *\/}</Dashboard.Filters>
 *   <Dashboard.Body>{table}</Dashboard.Body>
 * </Dashboard>
 * ```
 */
export const Dashboard = ({
  children,
  defaultFiltersVisible = true,
  activeFilterCount = 0,
  testIdPrefix = 'dashboard',
  className,
}: DashboardProps): React.JSX.Element => {
  const [filtersVisible, setFiltersVisible] = useState(defaultFiltersVisible);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  const value = useMemo(
    () => ({
      filtersVisible,
      toggleFilters: () => setFiltersVisible((v) => !v),
      moreFiltersOpen,
      toggleMoreFilters: () => setMoreFiltersOpen((v) => !v),
      activeFilterCount,
      testIdPrefix,
    }),
    [filtersVisible, moreFiltersOpen, activeFilterCount, testIdPrefix],
  );

  // Stable sort recognised slots into canonical order, preserving the original
  // order of anything unrecognised.
  const ordered = useMemo(() => {
    const arr = React.Children.toArray(children);
    return arr
      .map((node, index) => ({ node, index, rank: slotRank(node) }))
      .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
      .map((entry) => entry.node);
  }, [children]);

  return (
    <DashboardContext.Provider value={value}>
      <Root className={className} data-testid={testIdPrefix}>
        {ordered}
      </Root>
    </DashboardContext.Provider>
  );
};

Dashboard.displayName = 'Dashboard';

/* -------------------------------------------------------------------------- */
/* Breadcrumb                                                                 */
/* -------------------------------------------------------------------------- */

const DashboardBreadcrumb = ({
  items,
  renderLink,
  className,
}: DashboardBreadcrumbProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  return (
    <MuiBreadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      className={className}
      aria-label="breadcrumb"
      data-testid={`${testIdPrefix}-breadcrumb`}
      sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        if (isLast || !item.href) {
          return (
            <Typography
              key={`${item.label}-${index}`}
              component="span"
              sx={{ fontSize: '0.875rem', color: isLast ? 'text.primary' : 'text.secondary' }}
              aria-current={isLast ? 'page' : undefined}
            >
              {item.label}
            </Typography>
          );
        }
        const linkContent = item.label;
        if (renderLink) {
          return <React.Fragment key={`${item.label}-${index}`}>{renderLink(item, linkContent)}</React.Fragment>;
        }
        return (
          <MuiLink
            key={`${item.label}-${index}`}
            href={item.href}
            underline="hover"
            color="inherit"
            sx={{ fontSize: '0.875rem' }}
          >
            {linkContent}
          </MuiLink>
        );
      })}
    </MuiBreadcrumbs>
  );
};
DashboardBreadcrumb.displayName = 'Dashboard.Breadcrumb';
(DashboardBreadcrumb as SlottedComponent).dashboardSlot = 'breadcrumb';

/* -------------------------------------------------------------------------- */
/* Header + action parts                                                      */
/* -------------------------------------------------------------------------- */

const DashboardHeader = ({ title, children, className }: DashboardHeaderProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  return (
    <Box
      className={className}
      data-testid={`${testIdPrefix}-header`}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 40 }}
    >
      <Typography variant="h5" component="h1" sx={{ fontWeight: 600, mr: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
};
DashboardHeader.displayName = 'Dashboard.Header';
(DashboardHeader as SlottedComponent).dashboardSlot = 'header';

/** Flexible spacer — everything composed after it is pushed to the right. */
/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

const DashboardFilters = ({ children, className }: DashboardFiltersProps): React.JSX.Element => {
  const { filtersVisible, testIdPrefix } = useDashboardContext();
  return (
    <Collapse in={filtersVisible} unmountOnExit data-testid={`${testIdPrefix}-filters`}>
      <Box
        className={className}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          p: 2,
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        {children}
      </Box>
    </Collapse>
  );
};
DashboardFilters.displayName = 'Dashboard.Filters';
(DashboardFilters as SlottedComponent).dashboardSlot = 'filters';

const DashboardMoreFilters = ({ children, label = 'More filters' }: DashboardMoreFiltersProps): React.JSX.Element => {
  const { moreFiltersOpen, toggleMoreFilters, testIdPrefix } = useDashboardContext();
  return (
    <Box>
      <Button
        variant="text"
        size="small"
        startIcon={<FilterIcon fontSize="small" />}
        endIcon={moreFiltersOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        onClick={toggleMoreFilters}
        aria-expanded={moreFiltersOpen}
        data-testid={`${testIdPrefix}-more-filters-toggle`}
      >
        {label}
      </Button>
      <Collapse in={moreFiltersOpen} unmountOnExit data-testid={`${testIdPrefix}-more-filters-panel`}>
        <Box sx={{ mt: 1.5, p: 2, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
};
DashboardMoreFilters.displayName = 'Dashboard.MoreFilters';

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

const DashboardBody = ({ children, className }: DashboardBodyProps): React.JSX.Element => {
  const { testIdPrefix } = useDashboardContext();
  return (
    <Box className={className} data-testid={`${testIdPrefix}-body`}>
      {children}
    </Box>
  );
};
DashboardBody.displayName = 'Dashboard.Body';
(DashboardBody as SlottedComponent).dashboardSlot = 'body';

/* -------------------------------------------------------------------------- */
/* Attach sub-components as dot-notation parts                                */
/* -------------------------------------------------------------------------- */

Dashboard.Breadcrumb = DashboardBreadcrumb;
Dashboard.Header = DashboardHeader;
Dashboard.Spacer = DashboardSpacer;
Dashboard.Info = DashboardInfo;
Dashboard.FilterToggle = DashboardFilterToggle;
Dashboard.Settings = DashboardSettings;
Dashboard.Export = DashboardExport;
Dashboard.Action = DashboardAction;
Dashboard.Actions = DashboardActions;
Dashboard.Filters = DashboardFilters;
Dashboard.MoreFilters = DashboardMoreFilters;
Dashboard.Body = DashboardBody;
