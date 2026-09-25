'use client';

import Box from '@mui/material/Box/index.js';
import { alpha, useTheme, type Theme } from '@mui/material/styles/index.js';
import React, { useEffect, useRef, type RefObject } from 'react';

import { watchVisitorScroll } from './SettingsSectionChips.scroll';
import { SettingsStatusMarker } from './SettingsStatusMarker';
import { TOUCH_TARGET } from './SettingsLayout.styles';
import { rem, sxRem } from '../../../tokens/relative';

/**
 * The chip's drawn height, against `TOUCH_TARGET`'s 44 for the tappable one.
 *
 * The strip sits between a section's header and its first field on the width
 * with the least room for either, so the pill is sized to its text rather than
 * to the thumb — and the thumb is served by the hit area instead.
 */
const CHIP_HEIGHT = sxRem(34);
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
 * Where the strip has to scroll for `chip`'s centre to sit on its own, clamped
 * to what the strip can scroll.
 *
 * Measured from the two boxes rather than from `chip.offsetLeft`. `offsetLeft`
 * counts from the nearest POSITIONED ancestor, and the strip is not one — nor
 * are the panel and layout around it — so it counted from whatever box the host
 * happened to position, and every target overshot by the strip's offset inside
 * it. The clamp hid that for the last chip; a middle one was simply off-centre.
 * The boxes are both in viewport coordinates, so their difference is the strip's
 * own, whatever the host wraps it in.
 */
function centredScrollLeft(strip: HTMLElement, chip: HTMLElement): number {
  const chipBox = chip.getBoundingClientRect();
  const visibleStart = strip.getBoundingClientRect().left + strip.clientLeft;
  const chipCentre = chipBox.left - visibleStart + strip.scrollLeft + chipBox.width / 2;
  const target = chipCentre - strip.clientWidth / 2;
  return Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
}

/** The chip for `id`, walked rather than selected. */
function findChip(strip: HTMLElement, id: string): HTMLElement | undefined {
  // An id is host data, and a section id carrying a quote would turn a selector
  // string into a thrown SyntaxError — which here would take the whole strip
  // down to centre one chip.
  return Array.from(strip.children).find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.dataset.chipId === id,
  );
}

/**
 * Keep the open section's chip in view, however the visitor got here — and
 * however the strip's content settles after it mounted.
 *
 * Keyed on `activeItemId` in an effect rather than done in a click handler:
 * arriving by the desktop rail, by a card, by a pasted link and by the browser's
 * back button all have to land the same way, and only one of those is a click on
 * a chip. Every re-render otherwise starts the strip at scroll 0, which parks
 * the active chip off the right edge on any list longer than a screen — the
 * visitor is told where they are by an element they cannot see.
 *
 * Centring ONCE is not enough (FUT-2606). A host can widen a chip after mount
 * with the ids unchanged — a status marker whose read resolves late, a web font
 * arriving — and a strip that fitted at mount then overflows with its last chip
 * clipped, because the one centring saw nothing to scroll. So the strip and
 * every chip are watched with a `ResizeObserver`, and a resize re-aims at the
 * active chip when its target has moved.
 *
 * Never against the visitor, though: once they have scrolled the strip
 * themselves, it is theirs until the open section changes
 * ({@link watchVisitorScroll}, which also says why the strip's OWN smooth scroll
 * never counts as theirs). A strip that yanks back mid-drag because a
 * marker loaded is worse than one that does not centre.
 *
 * `itemsKey` rather than `items`: a host almost always rebuilds that array per
 * render (`groups.flatMap(...)`), and depending on it would re-run this on every
 * render and reset the visitor's latch with it.
 *
 * The key joins on NUL — as the ESCAPE `'\u0000'`, which it must stay. A
 * literal NUL byte works identically at runtime and makes git classify this file
 * as BINARY: `git diff` prints "Binary file not shown" and the GitHub review UI
 * shows nothing at all. This file shipped that way once, and the cost was not
 * the byte — it was a whole change nobody could read.
 */
function useCentreActiveChip(
  stripRef: RefObject<HTMLDivElement | null>,
  activeItemId: string | undefined,
  itemsKey: string,
): void {
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeItemId) return undefined;
    // Feature-checked, not assumed. `Element.scrollTo` is absent in jsdom and in
    // a few embedded webviews, and an unguarded call there THROWS out of an
    // effect — which React escalates to the nearest error boundary. The whole
    // settings area would go down to centre one chip, and the host's own tests
    // could not render the shell at all. Same reasoning as walking the children
    // instead of building a selector: nothing in here is worth a crash.
    if (typeof strip.scrollTo !== 'function') return undefined;
    const visitor = watchVisitorScroll(strip);
    const centre = (): void => {
      const chip = findChip(strip, activeItemId);
      // Not while a scroll that may be the visitor's is still moving: a resize
      // mid-drag must not yank the strip. It is re-tried once that scroll rests.
      if (!chip || visitor.hasScrolled() || visitor.isUndecided()) return;
      const left = centredScrollLeft(strip, chip);
      // Only when the target MOVED: a resize that leaves it where it was must not
      // restart a smooth scroll that is already on its way there. The aim is a
      // runtime-computed scroll offset, like the exempt `left` below — not a size.
      if (Math.abs(left - visitor.aimedAt()) < 0.5) return;
      visitor.beforeOwnScroll(left);
      strip.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };
    visitor.onSettled(centre);
    centre();
    // Also feature-checked: without it the strip still centres once, as before.
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(centre) : undefined;
    resizes?.observe(strip);
    for (const child of Array.from(strip.children)) resizes?.observe(child);
    return () => {
      resizes?.disconnect();
      visitor.detach();
    };
  }, [stripRef, activeItemId, itemsKey]);
}

/** One chip: a link when the host gave it a target, else a button. */
function SectionChip({
  item,
  active,
  theme,
  linkComponent,
  onSelectItem,
  testIdPrefix,
}: {
  item: SettingsNavItem;
  active: boolean;
  theme: Theme;
  linkComponent?: SettingsLayoutProps['linkComponent'];
  onSelectItem?: (id: string) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const asLink = item.href !== undefined && linkComponent !== undefined;
  const behaviour = asLink
    ? { component: linkComponent, href: item.href }
    : { component: 'button' as const, type: 'button' as const, onClick: () => onSelectItem?.(item.id) };

  return (
    <Box
      {...behaviour}
      data-chip-id={item.id}
      data-testid={`${testIdPrefix}-chip-${item.id}`}
      aria-current={active ? 'page' : undefined}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        flex: '0 0 auto',
        position: 'relative',
        // The chip LOOKS this tall; it is still tapped at `TOUCH_TARGET`.
        //
        // Shrinking `minHeight` alone would have bought a slimmer strip with a
        // smaller hit area — on the one width where the strip IS the navigation
        // and the input is a thumb. The `::after` below keeps the tappable
        // region at the full target while the pill itself takes less room, so
        // this is a visual change and not an accessibility trade.
        minHeight: CHIP_HEIGHT,
        px: 1.5,
        borderRadius: 999,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: rem(theme, 13),
        fontWeight: active ? 700 : 500,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        color: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
        border: `1px solid ${active ? alpha(theme.palette.primary.main, 0.4) : theme.palette.divider}`,
        // Spans the chip's width only, so neighbours never overlap: the strip
        // is a row, and the extra reach is vertical.
        '&::after': {
          content: '""',
          position: 'absolute',
          insetInlineStart: 0,
          insetInlineEnd: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: rem(theme, TOUCH_TARGET),
        },
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
}

/**
 * The narrow-width section strip: horizontally scrollable chips for the sections
 * beside the open one.
 *
 * It clips its own overflow — `overflow-x: auto` on the strip, never on an
 * ancestor. A strip that pushes the page wide makes every OTHER screen at that
 * width scroll sideways too, and the cause is nowhere near the symptom.
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
  useCentreActiveChip(stripRef, activeItemId, items.map((item) => item.id).join('\u0000'));

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
        py: 0.25,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {items.map((item) => (
        <SectionChip
          key={item.id}
          item={item}
          active={item.id === activeItemId}
          theme={theme}
          linkComponent={linkComponent}
          onSelectItem={onSelectItem}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </Box>
  );
}

SettingsSectionChips.displayName = 'SettingsSectionChips';
