'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import { Box } from '@mui/material';
import React from 'react';

import { displayAcrossRail, TOUCH_TARGET } from './SettingsLayout.styles';
import type { SettingsLayoutProps, SettingsRailBreakpoint } from './SettingsLayout.types';

/** One line that must not wrap, whatever the section is called. */
const CLIP = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/**
 * The name of where you are, and optionally what it holds.
 *
 * `minWidth: 0` on the wrapper is what lets the clipping work at all: without
 * it a flex item refuses to shrink below its content, so a long section name
 * pushes the back button off the row instead of ellipsising.
 */
function HeaderText({
  title,
  description,
}: {
  title: string;
  description?: string;
}): React.JSX.Element {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        component="h2"
        sx={{ m: 0, font: 'inherit', fontSize: '1rem', fontWeight: 600, lineHeight: 1.3, ...CLIP }}
      >
        {title}
      </Box>
      {description !== undefined && description !== '' && (
        <Box
          component="p"
          sx={{
            m: 0,
            font: 'inherit',
            fontSize: '0.8125rem',
            color: 'text.secondary',
            lineHeight: 1.35,
            ...CLIP,
          }}
        >
          {description}
        </Box>
      )}
    </Box>
  );
}

/**
 * The narrow-width panel header: a back control, and the name of where you are.
 *
 * ## Why this replaced a "‹ Voltar" link
 *
 * The bare link spent a whole row saying only that a back existed. Under it came
 * the sibling chips and under those the section's own Salvar, so three stacked
 * rows went by before the first field — on the width with the least room for
 * them. Worse, none of the three said WHICH section was open: the chips mark the
 * active one, but a chip strip scrolls, so the answer could be off-screen.
 *
 * Folding the control into a square button beside the title buys back a row and
 * makes the header say where you are, which is what a header is for.
 *
 * ## Narrow only, and mounted at every width
 *
 * `displayAcrossRail` hides this above the breakpoint rather than unmounting it,
 * for the reason the whole component works that way: navigation that exists at
 * one width and not the other is navigation nothing can assert about. Above the
 * breakpoint the rail is on screen with the open row marked, so a back control
 * would point at a list already visible.
 *
 * The button is `TOUCH_TARGET` square because this is the phone shape, and it
 * keeps the accessible name — the visible text is the section, not the verb, so
 * a screen reader still hears "Voltar" rather than being handed an icon.
 */
export function SettingsSectionHeader({
  href,
  backLabel,
  title,
  description,
  breakpoint,
  linkComponent,
  testIdPrefix,
}: {
  href: string;
  backLabel: string;
  title: string;
  description?: string;
  breakpoint: SettingsRailBreakpoint;
  linkComponent: NonNullable<SettingsLayoutProps['linkComponent']>;
  testIdPrefix: string;
}): React.JSX.Element {
  return (
    <Box
      data-testid={`${testIdPrefix}-section-header`}
      sx={(theme) => ({
        ...displayAcrossRail(theme, breakpoint, 'flex', 'none'),
        alignItems: 'center',
        gap: 1.5,
        minWidth: 0,
        pb: 1.5,
      })}
    >
      <Box
        component={linkComponent}
        href={href}
        aria-label={backLabel}
        data-testid={`${testIdPrefix}-back`}
        sx={(theme) => ({
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: TOUCH_TARGET,
          height: TOUCH_TARGET,
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          color: 'text.primary',
          textDecoration: 'none',
          '&:hover': { backgroundColor: theme.palette.action.hover },
        })}
      >
        <ChevronLeftIcon fontSize="small" />
      </Box>

      <HeaderText title={title} description={description} />
    </Box>
  );
}
