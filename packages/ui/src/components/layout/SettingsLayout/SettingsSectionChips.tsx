'use client';

import { alpha, Box, useTheme } from '@mui/material';
import React, { useEffect, useRef } from 'react';

import { SettingsStatusMarker } from './SettingsStatusMarker';
import { TOUCH_TARGET } from './SettingsLayout.styles';
import type { SettingsLayoutProps, SettingsNavItem } from './SettingsLayout.types';

export interface SettingsSectionChipsProps {
  /** The sibling sections to offer — usually the open item's own group. */
  items: SettingsNavItem[];
  /** Which one is open. */
  activeItemId?: string;
  /** Accessible name of the strip, in the host's language. */
  ariaLabel: string;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  testIdPrefix: string;
}

/** True when the visitor asked the OS for less movement. Re-read per scroll. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The narrow-width section strip: horizontally scrollable chips for the sections
 * beside the open one.
 *
 * ## It scrolls itself to the open section
 *
 * Every re-render starts the strip back at scroll 0, which parks the active chip
 * off the right edge on any list longer than a screen — the operator is told
 * where they are by an element they cannot see. So the strip centres the active
 * chip itself, in an effect keyed on `activeItemId` rather than in a click
 * handler: arriving by the desktop rail, by a card, by a pasted link and by the
 * browser's back button all have to land the same way, and only one of those is
 * a click on a chip.
 *
 * `prefers-reduced-motion` is read at scroll time rather than captured once, so
 * a visitor who changes the setting mid-session is honoured without a remount.
 *
 * ## It clips its own overflow
 *
 * `overflow-x: auto` on the strip, never on an ancestor. A strip that pushes the
 * page wide makes every OTHER screen at that width scroll sideways too, and the
 * cause is nowhere near the symptom.
 */
export function SettingsSectionChips({
  items,
  activeItemId,
  ariaLabel,
  linkComponent,
  onSelectItem,
  testIdPrefix,
}: SettingsSectionChipsProps): React.JSX.Element {
  const theme = useTheme();
  const stripRef = useRef<HTMLDivElement | null>(null);
  // Keyed on the ids rather than on `items`, which a host almost always rebuilds
  // per render (`groups.flatMap(...)`). Depending on the array itself would
  // re-run this on every render and yank the strip back mid-drag, every time.
  const itemsKey = items.map((item) => item.id).join('\u0000');

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeItemId) return;
    // Walked rather than selected: an id is host data, and a section id carrying
    // a quote would turn a selector string into a thrown SyntaxError — which
    // here would take the whole strip down to centre one chip.
    const chip = Array.from(strip.children).find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.dataset.chipId === activeItemId,
    );
    if (!chip) return;
    const target = chip.offsetLeft + chip.offsetWidth / 2 - strip.clientWidth / 2;
    const left = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
    strip.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [activeItemId, itemsKey]);

  return (
    <Box
      ref={stripRef}
      component="nav"
      aria-label={ariaLabel}
      data-testid={`${testIdPrefix}-chips`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.25,
        py: 0.75,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {items.map((item) => {
        const active = item.id === activeItemId;
        const LinkComponent = item.href && linkComponent ? linkComponent : 'button';
        return (
          <Box
            key={item.id}
            component={LinkComponent}
            {...(item.href && linkComponent ? { href: item.href } : { type: 'button' })}
            onClick={item.href && linkComponent ? undefined : () => onSelectItem?.(item.id)}
            data-chip-id={item.id}
            data-testid={`${testIdPrefix}-chip-${item.id}`}
            aria-current={active ? 'page' : undefined}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              flex: '0 0 auto',
              minHeight: TOUCH_TARGET,
              px: 1.5,
              borderRadius: 999,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '0.8125rem',
              fontWeight: active ? 700 : 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              color: active ? 'primary.main' : 'text.secondary',
              bgcolor: active ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
              border: `1px solid ${active ? alpha(theme.palette.primary.main, 0.4) : theme.palette.divider}`,
            }}
          >
            {item.status ? (
              <SettingsStatusMarker
                status={item.status}
                label={item.statusLabel}
                testId={`${testIdPrefix}-chip-status-${item.id}`}
              />
            ) : null}
            {item.label}
          </Box>
        );
      })}
    </Box>
  );
}

SettingsSectionChips.displayName = 'SettingsSectionChips';
