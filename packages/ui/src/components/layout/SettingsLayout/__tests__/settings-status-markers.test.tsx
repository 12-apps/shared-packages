/**
 * The situation markers, one per status: what each is drawn as, the visible
 * word only `attention` carries, and the accessible text each row keeps.
 *
 * `new` is a hollow ring in the primary colour, not a red dot, and `attention`
 * is amber with a word, so the one row that needs action is findable among
 * the rows that merely have not been opened yet.
 */
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { SettingsLayout } from '../SettingsLayout';
import type { SettingsNavItem } from '../SettingsLayout.types';
import { getContrastRatio } from '../../../../tokens/color';
import {
  SettingsStatusMarker,
  STATUS_WORD_MIN_CONTRAST,
  statusWordColor,
  statusWordSurfaces,
  visibleStatusWord,
} from '../SettingsStatusMarker';

const theme = createTheme({
  palette: {
    primary: { main: '#B4552E' },
    warning: { main: '#8C5908' },
    error: { main: '#A83A2A' },
  },
});

/** A fresh list per call, so no test can reach another's items. */
function markedItems(): SettingsNavItem[] {
  return [
    { id: 'profile', label: 'Profile', status: 'ok', statusLabel: 'On' },
    { id: 'hours', label: 'Hours', status: 'off', statusLabel: 'Off' },
    {
      id: 'fiscal',
      label: 'Invoices',
      status: 'new',
      statusLabel: 'Not opened yet',
    },
    {
      id: 'address',
      label: 'Address',
      status: 'attention',
      statusText: 'Pending',
      statusLabel: 'Pending: the tax id is missing',
    },
    {
      id: 'domain',
      label: 'Domain',
      status: 'locked',
      statusLabel: 'In a higher plan',
    },
  ];
}

function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return [];
  }
}

/** The emotion-generated rule text for an element, spaces stripped, lower-cased. */
function styleTextOf(el: Element): string {
  const classes = Array.from(el.classList);
  return Array.from(document.styleSheets)
    .flatMap((sheet) => rulesOf(sheet))
    .filter((rule) => classes.some((cls) => rule.cssText.includes(`.${cls}`)))
    .map((rule) => rule.cssText)
    .join('')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

function markOf(testId: string): Element {
  const mark = screen.getByTestId(testId).querySelector('[data-status-mark]');
  if (!mark) throw new Error(`no mark inside ${testId}`);
  return mark;
}

/** `#8C5908` as the jsdom stylesheet prints it. */
const AMBER = 'rgb(140,89,8)';
const BRAND = 'rgb(180,85,46)';
const RED = 'rgb(168,58,42)';

function hexOrRgb(css: string, hex: string, rgb: string): boolean {
  return css.includes(hex.toLowerCase()) || css.includes(rgb);
}

function renderRail(items: SettingsNavItem[] = markedItems()): void {
  render(
    <ThemeProvider theme={theme}>
      <SettingsLayout
        title="Settings"
        groups={[{ id: 'store', label: 'Store', items }]}
        activeItemId="profile"
      >
        <div>panel</div>
      </SettingsLayout>
    </ThemeProvider>,
  );
}

function renderChips(items: SettingsNavItem[] = markedItems()): void {
  render(
    <ThemeProvider theme={theme}>
      <SettingsLayout
        title="Settings"
        groups={[{ id: 'store', label: 'Store', items }]}
        activeItemId="hours"
        navVariant="drilldown"
        atIndex={false}
        sectionChips={items}
      >
        <div>panel</div>
      </SettingsLayout>
    </ThemeProvider>,
  );
}

describe('the marker each status draws', () => {
  it('tags every row with its status', () => {
    renderRail();
    for (const [id, status] of [
      ['profile', 'ok'],
      ['hours', 'off'],
      ['fiscal', 'new'],
      ['address', 'attention'],
      ['domain', 'locked'],
    ] as const) {
      expect(screen.getByTestId(`settings-status-${id}`)).toHaveAttribute('data-status', status);
    }
  });

  it('draws `new` as a hollow ring in the primary colour, never in error.main', () => {
    renderRail();
    const css = styleTextOf(markOf('settings-status-fiscal'));
    expect(css).toContain('border-style:solid');
    expect(css).toContain('background-color:transparent');
    expect(hexOrRgb(css, '#B4552E', BRAND)).toBe(true);
    expect(hexOrRgb(css, '#A83A2A', RED)).toBe(false);
  });

  it('draws `attention` as a filled amber dot, larger than the ok and off dots', () => {
    renderRail();
    const attention = styleTextOf(markOf('settings-status-address'));
    expect(hexOrRgb(attention, '#8C5908', AMBER)).toBe(true);
    expect(attention).not.toContain('border-style:solid');
    expect(attention).toContain(`width:${theme.typography.pxToRem(10)}`);
    expect(styleTextOf(markOf('settings-status-hours'))).toContain(`width:${theme.typography.pxToRem(8)}`);
  });

  it('keeps `off` a filled grey dot, so it differs in shape from the ring', () => {
    renderRail();
    const css = styleTextOf(markOf('settings-status-hours'));
    expect(css).not.toContain('border-style:solid');
    expect(css).not.toContain('background-color:transparent');
  });

  it('keeps `locked` a padlock with no dot', () => {
    renderRail();
    expect(screen.getByTestId('settings-status-domain').querySelectorAll('[data-status-mark]')).toHaveLength(
      0,
    );
    expect(screen.getByTestId('settings-status-domain').querySelector('svg')).not.toBeNull();
  });
});

describe('the visible word', () => {
  it('shows the caller’s word on the attention row, in the darker amber', () => {
    renderRail();
    const word = screen.getByTestId('settings-status-text-address');
    expect(word).toHaveTextContent('Pending');
    expect(word).toHaveAttribute('aria-hidden', 'true');
    expect(styleTextOf(word)).toContain(
      `color:${theme.palette.warning.dark.replace(/\s+/gu, '').toLowerCase()}`,
    );
  });

  it('draws no word for any other status, even when the caller passes one', () => {
    const items = markedItems().map((item) => ({
      ...item,
      statusText: 'Word',
    }));
    renderRail(items);
    for (const id of ['profile', 'hours', 'fiscal', 'domain']) {
      expect(screen.queryAllByTestId(`settings-status-text-${id}`)).toHaveLength(0);
    }
    expect(screen.getByTestId('settings-status-text-address')).toHaveTextContent('Word');
  });

  it('draws no word for attention without one: the package has no copy of its own', () => {
    renderRail([
      {
        id: 'address',
        label: 'Address',
        status: 'attention',
        statusLabel: 'Pending',
      },
    ]);
    expect(screen.queryAllByTestId('settings-status-text-address')).toHaveLength(0);
    expect(visibleStatusWord({ status: 'attention', statusText: '  ' })).toBeUndefined();
  });

  it('keeps the row in place: the attention row is still between its neighbours', () => {
    renderRail();
    const ids = within(screen.getByTestId('settings-group-store'))
      .getAllByTestId(/^settings-item-/u)
      .map((row) => row.getAttribute('data-testid'));
    expect(ids).toEqual(markedItems().map((item) => `settings-item-${item.id}`));
  });
});

describe('the accessible text', () => {
  it('reads each row with its full label, the attention word not repeated', () => {
    renderRail();
    expect(screen.getByTestId('settings-item-fiscal')).toHaveAccessibleName('Invoices Not opened yet');
    expect(screen.getByTestId('settings-item-address')).toHaveAccessibleName(
      'Address Pending: the tax id is missing',
    );
    expect(screen.getByTestId('settings-item-hours')).toHaveAccessibleName('Hours Off');
  });

  it('falls back to the visible word when the caller gave no label', () => {
    renderRail([
      {
        id: 'address',
        label: 'Address',
        status: 'attention',
        statusText: 'Pending',
      },
    ]);
    expect(screen.getByTestId('settings-item-address')).toHaveAccessibleName('Address Pending');
  });

  it('renders the marker label as visually-hidden text', () => {
    render(
      <ThemeProvider theme={theme}>
        <SettingsStatusMarker status="new" label="Not opened yet" testId="m" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('m')).toHaveTextContent('Not opened yet');
  });
});

describe('the phone chip', () => {
  it('carries the marker, the label and then the word, on an amber wash', () => {
    renderChips();
    const chip = screen.getByTestId('settings-chip-address');
    expect(within(chip).getByTestId('settings-chip-status-address')).toHaveAttribute(
      'data-status',
      'attention',
    );
    const word = within(chip).getByTestId('settings-chip-status-text-address');
    expect(word).toHaveTextContent('Pending');
    expect(word.previousSibling?.textContent).toBe('Address');
    expect(styleTextOf(word)).toContain('content:"·"');
    expect(hexOrRgb(styleTextOf(chip), '#8C5908', AMBER) || styleTextOf(chip).includes('rgba(140,89,8')).toBe(
      true,
    );
  });

  it('draws the ring on a new chip and no word', () => {
    renderChips();
    const css = styleTextOf(markOf('settings-chip-status-fiscal'));
    expect(css).toContain('border-style:solid');
    expect(screen.queryAllByTestId('settings-chip-status-text-fiscal')).toHaveLength(0);
  });

  it('names the attention chip with the full label, the word not read twice', () => {
    renderChips();
    // The marker leads the chip, as on every chip, so its label is read first.
    expect(screen.getByTestId('settings-chip-address')).toHaveAccessibleName(
      'Pending: the tax id is missing Address',
    );
  });
});

describe('the word’s contrast', () => {
  const themes = {
    'MUI’s default light theme (warning.dark #e65100 is 3.79:1 on white)': createTheme(),
    'MUI’s default dark theme': createTheme({ palette: { mode: 'dark' } }),
    'a host palette': theme,
    'a host palette in dark mode': createTheme({ palette: { mode: 'dark', primary: { main: '#EE7B1F' }, warning: { main: '#CF960C' } } }),
  };

  for (const [name, subject] of Object.entries(themes)) {
    it(`reads at 4.5:1 or more on every surface it sits on, in ${name}`, () => {
      const ink = statusWordColor(subject);
      for (const surface of statusWordSurfaces(subject)) {
        expect(getContrastRatio(ink, surface)).toBeGreaterThanOrEqual(STATUS_WORD_MIN_CONTRAST);
      }
    });
  }

  it('keeps the theme’s own step when it already passes', () => {
    expect(statusWordColor(theme)).toBe(theme.palette.warning.dark);
  });
});
