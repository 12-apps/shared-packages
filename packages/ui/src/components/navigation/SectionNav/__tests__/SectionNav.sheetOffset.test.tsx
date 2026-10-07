/**
 * The bar's sheets stop clear of the raised button (FUT-3328): the bar sits
 * above the backdrop while a sheet is open, and the button stands out of its
 * top edge — a sheet that stopped at the bar had the button drawn over it.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { rem } from '../../../../tokens/scales';
import { SectionNav } from '../SectionNav';
import { sectionNavBarInset, sectionNavSheetOffset } from '../SectionNav.bar';
import { RAISED_LIFT, RAISED_LIFT_COMPACT } from '../SectionNav.primary';
import type { SectionNavMenu } from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg />;
const MORE: SectionNavMenu = {
  label: 'More',
  icon,
  title: 'More',
  groups: [{ id: 'rest', layout: 'grid', entries: [{ id: 'queue', label: 'Queue', icon, href: '/queue' }] }],
};
const CREATE: SectionNavMenu = { ...MORE, label: 'Create', title: 'Create' };

describe('sectionNavSheetOffset', () => {
  const theme = createTheme();

  it('stops a sheet above the raised button when the bar has one', () => {
    expect(sectionNavSheetOffset(theme, true)).toBe(`calc(${sectionNavBarInset(theme)} + ${rem(theme, RAISED_LIFT)})`);
  });

  it('stops it at the bar when there is no raised button to clear', () => {
    expect(sectionNavSheetOffset(theme, false)).toBe(sectionNavBarInset(theme));
  });

  it('clears the compact bar\'s smaller lift above the compact bar', () => {
    const compact = { compact: true };
    expect(sectionNavSheetOffset(theme, true, compact)).toBe(
      `calc(${sectionNavBarInset(theme, compact)} + ${rem(theme, RAISED_LIFT_COMPACT)})`,
    );
    expect(sectionNavSheetOffset(theme, false, compact)).toBe(sectionNavBarInset(theme, compact));
  });
});

/**
 * The CSS of the open More sheet's own paper — jsdom cannot evaluate a `calc()`
 * bottom, and emotion keeps every rule it ever injected, so read only the rules
 * of the classes this paper carries.
 */
function cssOfOpenMoreSheet(): string {
  fireEvent.click(screen.getByTestId('nav-more'));
  const sheet = screen.getByTestId('nav-more-sheet');
  const paper = sheet.querySelector('.MuiDrawer-paper') ?? sheet;
  // The library Drawer sets the paper's box from its ROOT (`& .MuiDrawer-paper`),
  // so the rule may hang off any class between the paper and the sheet's root.
  const classes: string[] = [];
  for (let node: Element | null = paper; node; node = node.parentElement) {
    classes.push(...Array.from(node.classList).filter((name) => name.startsWith('css-')));
    if (node === sheet) break;
  }
  const css = Array.from(document.querySelectorAll('style'), (style) => style.textContent ?? '').join('').replace(/\s+/g, '');
  return classes.flatMap((name) => css.match(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, 'g')) ?? []).join('');
}

describe('the More sheet, open', () => {
  const theme = createTheme();
  const cleared = `bottom:${sectionNavSheetOffset(theme, true)}`.replace(/\s+/g, '');

  it('clears the raised button beside it', () => {
    render(
      <SectionNav layout="bar" label="Section" destinations={[]} primary={CREATE} more={MORE} copy={EN_US_SECTION_NAV_COPY} dataTestId="nav" />,
    );

    expect(cssOfOpenMoreSheet()).toContain(cleared);
  });

  it('sits on the bar when the bar has no raised button', () => {
    render(<SectionNav layout="bar" label="Section" destinations={[]} more={MORE} copy={EN_US_SECTION_NAV_COPY} dataTestId="nav" />);

    const css = cssOfOpenMoreSheet();
    expect(css).toContain(`bottom:${sectionNavBarInset(theme)}`.replace(/\s+/g, ''));
    expect(css).not.toContain(cleared);
  });
});
