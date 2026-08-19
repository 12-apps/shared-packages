'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import { Box } from '@mui/material';
import React from 'react';

import { atLeastRail, displayAcrossRail, TOUCH_TARGET } from './SettingsLayout.styles';
import { SettingsSectionChips } from './SettingsSectionChips';
import type {
  SettingsLayoutProps,
  SettingsNavItem,
  SettingsRailBreakpoint,
} from './SettingsLayout.types';

export interface SettingsPanelProps {
  /** True in `drilldown`, inside a section rather than at the index. */
  inSection: boolean;
  /** True in `drilldown`, at the area's index. */
  hideOnNarrow: boolean;
  breakpoint: SettingsRailBreakpoint;
  indexHref?: string;
  backLabel: string;
  ariaLabel: string;
  sectionChips?: SettingsNavItem[];
  activeItemId?: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  testIdPrefix: string;
  children: React.ReactNode;
  /** Scroll inside the panel rather than with the page. See `fillHeight`. */
  fillHeight?: boolean;
}

/** The way back to the area's index — narrow widths only. */
function BackLink({
  href,
  label,
  breakpoint,
  linkComponent,
  testIdPrefix,
}: {
  href: string;
  label: string;
  breakpoint: SettingsRailBreakpoint;
  linkComponent: NonNullable<SettingsLayoutProps['linkComponent']>;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      component={linkComponent}
      href={href}
      aria-label={label}
      data-testid={`${testIdPrefix}-back`}
      sx={(theme) => ({
        ...displayAcrossRail(theme, breakpoint, 'inline-flex', 'none'),
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
      {label}
    </Box>
  );
}

/**
 * The central column: the open screen, and — in `drilldown`, inside a section —
 * the back link and sibling-section strip above it.
 *
 * At the index in `drilldown` this whole column is `display: none` below the
 * breakpoint and the rail becomes the page. Mounted either way: the panel and
 * the list are one tree with `display` between them, not two branches of a
 * render.
 */
export function SettingsPanel({
  inSection,
  hideOnNarrow,
  breakpoint,
  indexHref,
  backLabel,
  ariaLabel,
  sectionChips,
  activeItemId,
  linkComponent,
  onSelectItem,
  testIdPrefix,
  fillHeight = false,
  children,
}: SettingsPanelProps): React.JSX.Element {
  const showBack = inSection && indexHref !== undefined && linkComponent !== undefined;
  const showChips = inSection && sectionChips !== undefined && sectionChips.length > 0;

  return (
    <Box
      data-testid={`${testIdPrefix}-panel`}
      sx={(theme) => ({
        ...(hideOnNarrow
          ? displayAcrossRail(theme, breakpoint, 'none', 'block')
          : { display: 'block' }),
        flex: '1 1 auto',
        minWidth: 0,
        width: '100%',
        // The panel scrolls itself, which is what lets a `position: sticky`
        // toolbar inside `children` pin to the TOP OF THE PANEL — under the
        // host's header — rather than to a document that is not the scroller.
        ...(fillHeight
          ? {
              [atLeastRail(theme, breakpoint)]: {
                height: '100%',
                minHeight: 0,
                overflowY: 'auto' as const,
                overscrollBehavior: 'contain' as const,
              },
            }
          : {}),
      })}
    >
      {showBack ? (
        <BackLink
          href={indexHref}
          label={backLabel}
          breakpoint={breakpoint}
          linkComponent={linkComponent}
          testIdPrefix={testIdPrefix}
        />
      ) : null}

      {showChips ? (
        <Box
          sx={(theme) => ({
            ...displayAcrossRail(theme, breakpoint, 'block', 'none'),
            mb: 1,
            minWidth: 0,
          })}
        >
          <SettingsSectionChips
            items={sectionChips}
            activeItemId={activeItemId}
            ariaLabel={ariaLabel}
            linkComponent={linkComponent}
            onSelectItem={onSelectItem}
            testIdPrefix={testIdPrefix}
          />
        </Box>
      ) : null}

      {children}
    </Box>
  );
}
