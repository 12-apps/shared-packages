'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import { Box } from '@mui/material';
import React, { useMemo, useState } from 'react';

import { activeItemLabel, filterGroups, SettingsRail } from './SettingsLayout.parts';
import { atLeastRail, displayAcrossRail, TOUCH_TARGET } from './SettingsLayout.styles';
import { SettingsSectionChips } from './SettingsSectionChips';
import type { SettingsLayoutProps } from './SettingsLayout.types';

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
 * not the other can offer the phone less than the desktop, and no test or review
 * catches it — the missing control simply is not in the tree to be asserted
 * about. With both forms always mounted, "the narrow width reaches everything
 * the wide one does" holds by construction, and an audit that counts controls
 * per width gets the same answer at both.
 */
export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  title,
  groups,
  activeItemId,
  onSelectItem,
  searchPlaceholder = 'Search settings',
  emptySearchLabel = 'No settings match your search.',
  emptySearchAction,
  linkComponent,
  children,
  testIdPrefix = 'settings',
  railBreakpoint = 'md',
  navVariant = 'switcher',
  atIndex = false,
  indexHref,
  backLabel = 'Back',
  sectionChips,
}) => {
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const activeLabel = useMemo(() => activeItemLabel(groups, activeItemId), [groups, activeItemId]);

  const drilldown = navVariant === 'drilldown';
  const inSection = drilldown && !atIndex;
  const LinkComponent = linkComponent;

  return (
    <Box
      data-testid={testIdPrefix}
      data-nav-variant={navVariant}
      data-at-index={atIndex ? 'true' : 'false'}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 1.5,
        width: '100%',
        minWidth: 0,
        [atLeastRail(theme, railBreakpoint)]: { flexDirection: 'row', gap: 3 },
      })}
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

      <Box
        data-testid={`${testIdPrefix}-panel`}
        sx={(theme) => ({
          // At the index, `drilldown` hands the narrow width to the list and the
          // wide one to the panel. Both stay mounted; only `display` moves.
          ...(drilldown && atIndex
            ? displayAcrossRail(theme, railBreakpoint, 'none', 'block')
            : { display: 'block' }),
          flex: '1 1 auto',
          minWidth: 0,
          width: '100%',
        })}
      >
        {inSection && indexHref && LinkComponent ? (
          <Box
            component={LinkComponent}
            href={indexHref}
            aria-label={backLabel}
            data-testid={`${testIdPrefix}-back`}
            sx={(theme) => ({
              ...displayAcrossRail(theme, railBreakpoint, 'inline-flex', 'none'),
              alignItems: 'center',
              gap: 0.5,
              minHeight: TOUCH_TARGET,
              pr: 1,
              textDecoration: 'none',
              color: 'text.secondary',
              font: 'inherit',
              fontSize: '0.875rem',
            })}
          >
            <ChevronLeftIcon fontSize="small" />
            {backLabel}
          </Box>
        ) : null}

        {inSection && sectionChips && sectionChips.length > 0 ? (
          <Box
            sx={(theme) => ({
              ...displayAcrossRail(theme, railBreakpoint, 'block', 'none'),
              mb: 1,
              minWidth: 0,
            })}
          >
            <SettingsSectionChips
              items={sectionChips}
              activeItemId={activeItemId}
              ariaLabel={typeof title === 'string' ? title : 'Settings'}
              linkComponent={linkComponent}
              onSelectItem={onSelectItem}
              testIdPrefix={testIdPrefix}
            />
          </Box>
        ) : null}

        {children}
      </Box>
    </Box>
  );
};

SettingsLayout.displayName = 'SettingsLayout';
