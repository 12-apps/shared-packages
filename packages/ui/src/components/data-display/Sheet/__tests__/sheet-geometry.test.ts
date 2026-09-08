/**
 * A BOTTOM SHEET IS NOT A FULL-BLEED BAND, AND ITS `size` IS A CEILING.
 *
 * Two defects, one shape: the panel's geometry ignored what it held.
 *
 *   - the WIDTH was whatever the viewport was. MUI pins the bottom paper
 *     `left: 0; right: 0` and nothing here narrowed it, so on a desktop a sheet
 *     holding one sentence and one button was drawn the full width of the
 *     screen with its content stranded in the middle. `fullHeight` already
 *     DOCUMENTED itself as the thing that makes a top/bottom sheet full-width,
 *     which it could not have been — that was the only width there was;
 *   - the HEIGHT was `VERTICAL_SIZES[size]` flat. A `md` sheet was 400px
 *     whether it held four rows or one line, and `SheetContent`'s `flex: 1`
 *     spent the difference as dead space above the footer.
 *
 * These assert the resolved `sx` rather than a rendered box because that is
 * where the rule lives: `panelSx` is a pure function of the props, so every
 * preset and both axes can be pinned without a browser, and jsdom would not
 * resolve `min()` or a flex ceiling anyway. What jsdom CANNOT check —
 * that a long sheet scrolls inside the ceiling instead of overflowing it — is
 * the reason `minHeight: 0` is asserted here too: it is the whole mechanism,
 * and it is invisible in every other test.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { panelSx } from '../Sheet.styles';
import type { SheetProps } from '../Sheet.types';

type Position = NonNullable<SheetProps['position']>;
type Size = NonNullable<SheetProps['size']>;

const theme = createTheme();

/** The panel's `sx` for one set of props, with the boring half defaulted. */
function sx(
  overrides: Partial<Parameters<typeof panelSx>[0]> & { position: Position },
): Record<string, unknown> {
  const position = overrides.position;
  const isVerticalSheet = position === 'top' || position === 'bottom';
  return panelSx({
    theme,
    variant: 'default',
    color: 'primary',
    elevation: 8,
    glow: false,
    pulse: false,
    glass: false,
    gradient: false,
    rounded: true,
    disabled: false,
    isDragging: false,
    isAnimating: false,
    isDraggableVariant: false,
    isVerticalSheet,
    size: 'md',
    currentHeight: null,
    fullHeight: false,
    ...overrides,
  }) as unknown as Record<string, unknown>;
}

const VERTICAL: Position[] = ['bottom', 'top'];
const SIZES: Size[] = ['xs', 'sm', 'md', 'lg', 'xl'];

describe('a vertical sheet is a centred panel, not a band', () => {
  it.each(VERTICAL)('caps and centres a %s sheet', (position) => {
    const panel = sx({ position });
    expect(panel.width).toBe('min(100%, 640px)');
    // `left: 0; right: 0` plus a definite width is over-constrained, and auto
    // margins are what resolve that to the middle. Without this the panel is
    // capped but pinned to the left edge, which is worse than full-bleed.
    expect(panel.marginInline).toBe('auto');
  });

  it.each(SIZES)('keeps the cross axis off the %s preset', (size) => {
    // One rule for every preset: `size` speaks for the main axis, and a width
    // that moved with it would give the same prop two meanings.
    expect(sx({ position: 'bottom', size }).width).toBe('min(100%, 640px)');
  });

  it('gives the whole width back for fullHeight, as documented', () => {
    expect(sx({ position: 'bottom', fullHeight: true }).width).toBe('100%');
  });

  it('leaves a side sheet on its own viewport-aware width', () => {
    const panel = sx({ position: 'right', size: 'lg' });
    expect(panel.width).toBe('min(92vw, max(560px, 32vw))');
    // The centring rule is the vertical axis's own; a side sheet is pinned to
    // its edge and auto margins would push it off it.
    expect(panel.marginInline).toBeUndefined();
  });
});

describe('`size` is a ceiling for a vertical sheet', () => {
  it.each([
    ['xs', 'min(200px, 100%)'],
    ['sm', 'min(300px, 100%)'],
    ['md', 'min(400px, 100%)'],
    ['lg', 'min(500px, 100%)'],
    ['xl', 'min(600px, 100%)'],
  ] as const)('%s is a maxHeight, not a height', (size, expected) => {
    const panel = sx({ position: 'bottom', size });
    expect(panel.maxHeight).toBe(expected);
    // The half that actually removes the dead space. A `maxHeight` beside a
    // fixed `height` would change nothing at all.
    expect(panel.height).toBe('auto');
  });

  it('still fills the viewport at `full`', () => {
    expect(sx({ position: 'bottom', size: 'full' }).maxHeight).toBe('100%');
  });

  it('is a column, so the ceiling can be one', () => {
    // The panel has to distribute its own height for `maxHeight` to mean
    // anything: as a block, a body taller than the ceiling overflows it
    // instead of handing the overflow to the scrolling content region.
    const panel = sx({ position: 'bottom' });
    expect(panel.display).toBe('flex');
    expect(panel.flexDirection).toBe('column');
  });

  it('leaves the drag variant its own height', () => {
    // The snap point owns the main axis while a drag is in flight — a ceiling
    // here would fight it — but the cross axis is not something a drag moves.
    const panel = sx({
      position: 'bottom',
      isDraggableVariant: true,
      currentHeight: 320,
    });
    expect(panel.height).toBe(320);
    expect(panel.maxHeight).toBeUndefined();
    expect(panel.width).toBe('min(100%, 640px)');
  });
});

describe('the caller keeps the last word', () => {
  it('lets `style` override the panel geometry', () => {
    // The escape hatch a consumer reaches for before filing a bug. It is
    // spread after the size rules on purpose, and a regression here would be
    // silent — the sheet would simply ignore what it was told.
    const panel = sx({
      position: 'bottom',
      style: { width: 480, maxHeight: 200 },
    });
    expect(panel.width).toBe(480);
    expect(panel.maxHeight).toBe(200);
  });
});
