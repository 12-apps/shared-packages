/**
 * `searchable` and `railVariant`: an area small enough to take in at a glance
 * drops the search field and draws its rail as a narrow card.
 *
 * Both default to the shape every existing consumer has — the field, and a
 * 300px column ruled off from the panel — so an upgrade changes nothing for an
 * area that does not ask.
 */
import { createTheme } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsLayout } from '../SettingsLayout';
import type { SettingsLayoutProps, SettingsNavGroup } from '../SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'account',
    label: 'Conta',
    items: [
      { id: 'profile', label: 'Perfil e dados', href: '#/account/perfil' },
      { id: 'addresses', label: 'Endereços', href: '#/account/enderecos' },
    ],
  },
];

function renderLayout(props: Partial<SettingsLayoutProps> = {}): void {
  render(
    <SettingsLayout title="Minha conta" groups={GROUPS} activeItemId="profile" railBreakpoint={1024} {...props}>
      <div data-testid="panel-child">Perfil</div>
    </SettingsLayout>,
  );
}

/** A stylesheet's rules, or none when the browser refuses to expose them. */
function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return [];
  }
}

/** The emotion-generated rule text for an element, spaces stripped. */
function styleTextOf(el: HTMLElement): string {
  const classes = Array.from(el.classList);
  return Array.from(document.styleSheets)
    .flatMap((sheet) => rulesOf(sheet))
    .filter((rule) => classes.some((cls) => rule.cssText.includes(`.${cls}`)))
    .map((rule) => rule.cssText)
    .join('')
    .replace(/\s+/gu, '');
}

describe('searchable', () => {
  it('draws the search field by default', () => {
    renderLayout();
    expect(screen.getByTestId('settings-search')).toBeInTheDocument();
  });

  it('draws no search field when the area asks for none, and still every row', async () => {
    renderLayout({ searchable: false });
    await waitFor(() => expect(screen.queryByTestId('settings-search')).toBeNull());
    expect(screen.getAllByText('Perfil e dados').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Endereços').length).toBeGreaterThan(0);
  });
});

describe('railVariant', () => {
  it('rules the 300px column off from the panel by default', () => {
    renderLayout();
    const rail = screen.getByTestId('settings-rail');
    expect(rail).toHaveAttribute('data-rail-variant', 'divided');
    expect(styleTextOf(rail)).toContain('border-right:1pxsolid');
  });

  it('draws the rail as a bordered card when asked, with no rule against the panel', () => {
    renderLayout({ railVariant: 'card' });
    const rail = screen.getByTestId('settings-rail');
    const css = styleTextOf(rail);
    expect(rail).toHaveAttribute('data-rail-variant', 'card');
    expect(css).toContain('border:1pxsolid');
    expect(css).not.toContain('border-right:1pxsolid');
  });
});

describe('the card rail rows', () => {
  const theme = createTheme();
  const norm = (colour: string): string => colour.toLowerCase();

  it('draws the active row in the darker red, which keeps AA on its wash', () => {
    renderLayout({ railVariant: 'card' });
    const active = screen.getByTestId('settings-item-profile');
    expect(styleTextOf(active).toLowerCase()).toContain(`color:${norm(theme.palette.primary.dark)}`);
  });

  it('keeps the active row in primary.main on the ruled column, so an upgrade changes nothing', () => {
    renderLayout();
    const active = screen.getByTestId('settings-item-profile');
    expect(styleTextOf(active).toLowerCase()).not.toContain(`color:${norm(theme.palette.primary.dark)}`);
  });

  it('rings keyboard focus instead of the grey fill', () => {
    renderLayout({ railVariant: 'card' });
    const css = styleTextOf(screen.getByTestId('settings-item-addresses'));
    expect(css).toContain('.Mui-focusVisible{outline-style:solid');
  });
});

describe('the drilldown index list', () => {
  it('takes a second column from md, not from sm', () => {
    renderLayout({ navVariant: 'drilldown', atIndex: true });
    const list = screen.getByTestId('settings-group-account').querySelector('ul') as HTMLElement;
    const css = styleTextOf(list);
    expect(css).toContain('@media(min-width:900px){');
    expect(css).not.toContain('@media(min-width:600px){');
  });
});
