'use client';

import { Box } from '@mui/material';
import React, { useMemo, useState } from 'react';

import { activeItemLabel, filterGroups, SettingsRail } from './SettingsLayout.parts';
import type { SettingsLayoutProps } from './SettingsLayout.types';

/**
 * A reusable, agnostic Facebook-style settings shell: a searchable left rail of
 * grouped categories/subcategories and a central panel that renders the selected
 * configuration screen (`children`). Navigation is data-driven via `groups`; the
 * host owns routing (pass `linkComponent` + item `href`, or handle `onSelectItem`).
 *
 * Below `md` the rail collapses into a compact section-switcher (tap to reveal the
 * search + groups) so the panel content stays at the top on phones.
 */
export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  title,
  groups,
  activeItemId,
  onSelectItem,
  searchPlaceholder = 'Search settings',
  emptySearchLabel = 'No settings match your search.',
  linkComponent,
  children,
  testIdPrefix = 'settings',
}) => {
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const activeLabel = useMemo(() => activeItemLabel(groups, activeItemId), [groups, activeItemId]);

  return (
    <Box
      data-testid={testIdPrefix}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: 'stretch',
        gap: { xs: 1.5, md: 3 },
        width: '100%',
      }}
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
        filteredGroups={filteredGroups}
        activeItemId={activeItemId}
        linkComponent={linkComponent}
        onSelectItem={onSelectItem}
        onNavigate={() => setNavOpen(false)}
        testIdPrefix={testIdPrefix}
      />

      <Box data-testid={`${testIdPrefix}-panel`} sx={{ flex: '1 1 auto', minWidth: 0, width: '100%' }}>
        {children}
      </Box>
    </Box>
  );
};

SettingsLayout.displayName = 'SettingsLayout';
