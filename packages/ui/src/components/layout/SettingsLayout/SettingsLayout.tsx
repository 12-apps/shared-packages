'use client';

import { Box, type Theme } from '@mui/material';
import React, { useMemo, useState } from 'react';

import { withDefaults } from '../../../utils/withDefaults';
import { activeItemLabel, filterGroups } from './SettingsLayout.filters';
import { SettingsRail } from './SettingsLayout.rail';
import { atLeastRail } from './SettingsLayout.styles';
import { SettingsPanel } from './SettingsPanel';
import type { SettingsLayoutProps } from './SettingsLayout.types';

/**
 * The props with every default already applied.
 *
 * A table through `withDefaults` rather than a `= default` per destructured
 * prop: each of those is a branch, and seven of them put the component over the
 * complexity bar before it renders anything. The single cast is what buys the
 * body non-optional values — without it every use site would restate the
 * default as a `??`, which is the same default written twice and free to drift.
 */
type ResolvedProps = SettingsLayoutProps &
  Required<
    Pick<
      SettingsLayoutProps,
      | 'searchPlaceholder'
      | 'emptySearchLabel'
      | 'testIdPrefix'
      | 'railBreakpoint'
      | 'navVariant'
      | 'atIndex'
      | 'backLabel'
    >
  >;

const DEFAULTS = {
  searchPlaceholder: 'Search settings',
  emptySearchLabel: 'No settings match your search.',
  testIdPrefix: 'settings',
  railBreakpoint: 'md',
  navVariant: 'switcher',
  atIndex: false,
  backLabel: 'Back',
} satisfies Partial<SettingsLayoutProps>;

/** Stacked below the rail's breakpoint, two columns at and above it. */
function shellSx(breakpoint: SettingsLayoutProps['railBreakpoint']) {
  return (theme: Theme) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    gap: 1.5,
    width: '100%',
    minWidth: 0,
    [atLeastRail(theme, breakpoint ?? 'md')]: { flexDirection: 'row', gap: 3 },
  });
}

/**
 * A reusable, agnostic Facebook-style settings shell: a searchable left rail of
 * grouped categories/subcategories and a central panel that renders the selected
 * configuration screen (`children`). Navigation is data-driven via `groups`; the
 * host owns routing (pass `linkComponent` + item `href`, or handle `onSelectItem`).
 *
 * ## Two narrow-width shapes
 *
 * `navVariant="switcher"` (the default) folds the rail into a disclosure above
 * the panel. `navVariant="drilldown"` gives the phone shape instead: at the
 * area's index the LIST is the page, and inside a section the panel is the page
 * with a back link and a scrollable strip of sibling sections above it.
 *
 * ## Why the width decision is CSS and not JavaScript
 *
 * Every part that changes between the two shapes does it through a `display`
 * pair keyed on `railBreakpoint`. Nothing here asks a media query in JS and
 * renders one branch.
 *
 * That is not a performance preference. A layout that RENDERS one navigation and
 * not the other can offer the narrow width less than the wide one, and no test
 * or review catches it — the missing control simply is not in the tree to be
 * asserted about. With both forms always mounted, "the narrow width reaches
 * everything the wide one does" holds by construction, and an audit that counts
 * controls per width gets the same answer at both.
 */
export const SettingsLayout: React.FC<SettingsLayoutProps> = (props) => {
  const {
    title,
    groups,
    activeItemId,
    onSelectItem,
    searchPlaceholder,
    emptySearchLabel,
    emptySearchAction,
    linkComponent,
    children,
    testIdPrefix,
    railBreakpoint,
    navVariant,
    atIndex,
    indexHref,
    backLabel,
    sectionChips,
  } = withDefaults(props, DEFAULTS) as ResolvedProps;
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const activeLabel = useMemo(() => activeItemLabel(groups, activeItemId), [groups, activeItemId]);

  const drilldown = navVariant === 'drilldown';
  const ariaLabel = typeof title === 'string' ? title : 'Settings';

  return (
    <Box
      data-testid={testIdPrefix}
      data-nav-variant={navVariant}
      data-at-index={atIndex ? 'true' : 'false'}
      sx={shellSx(railBreakpoint)}
    >
      <SettingsRail
        title={title}
        activeLabel={activeLabel}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={searchPlaceholder}
        emptySearchLabel={emptySearchLabel}
        emptySearchAction={emptySearchAction}
        filteredGroups={filteredGroups}
        activeItemId={activeItemId}
        linkComponent={linkComponent}
        onSelectItem={onSelectItem}
        onNavigate={() => setNavOpen(false)}
        testIdPrefix={testIdPrefix}
        variant={navVariant}
        breakpoint={railBreakpoint}
        atIndex={atIndex}
      />

      <SettingsPanel
        inSection={drilldown && !atIndex}
        hideOnNarrow={drilldown && atIndex}
        breakpoint={railBreakpoint}
        indexHref={indexHref}
        backLabel={backLabel}
        ariaLabel={ariaLabel}
        sectionChips={sectionChips}
        activeItemId={activeItemId}
        linkComponent={linkComponent}
        onSelectItem={onSelectItem}
        testIdPrefix={testIdPrefix}
      >
        {children}
      </SettingsPanel>
    </Box>
  );
};

SettingsLayout.displayName = 'SettingsLayout';
