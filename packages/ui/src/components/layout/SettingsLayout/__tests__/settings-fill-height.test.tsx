/**
 * `fillHeight`: the rail and the panel each get a scrollbar, or neither does.
 *
 * Two things make this worth a test rather than a look.
 *
 * **It is opt-in for a reason.** The percentage heights only resolve where the
 * host has already given this component a definite height. Defaulting it on
 * would collapse every existing consumer's settings area, silently, on upgrade
 * — so "off unless asked" is a contract, not a preference.
 *
 * **`minHeight: 0` is the half that gets dropped.** A flex child refuses to
 * shrink below its content, so `overflow` never engages without it and the
 * rail simply grows the page again. That failure looks exactly like the bug
 * this fixes, which is why the assertion names it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsLayout } from '../SettingsLayout';
import type { SettingsNavGroup } from '../SettingsLayout.types';

const GROUPS: SettingsNavGroup[] = [
  {
    id: 'store',
    label: 'Loja',
    items: [
      { id: 'branding', label: 'Perfil e marca', href: '#/config/branding' },
      { id: 'location', label: 'Endereço', href: '#/config/location' },
    ],
  },
];

function renderLayout(fillHeight?: boolean): void {
  render(
    <SettingsLayout
      title="Configuração"
      groups={GROUPS}
      activeItemId="location"
      railBreakpoint={1024}
      {...(fillHeight === undefined ? {} : { fillHeight })}
    >
      <div data-testid="panel-child">Endereço</div>
    </SettingsLayout>,
  );
}

/** The emotion-generated rule text for an element, across its class chain. */
function styleTextOf(el: HTMLElement): string {
  const classes = Array.from(el.classList);
  let text = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (classes.some((cls) => rule.cssText.includes(`.${cls}`))) text += rule.cssText;
    }
  }
  // `cssText` normalises to `prop: value`, so compare without the spaces
  // rather than guessing which side of the colon a serialiser puts them.
  return text.replace(/\s+/gu, '');
}

describe('fillHeight', () => {
  it('gives the rail and the panel their own scroll when asked', () => {
    renderLayout(true);

    const rail = styleTextOf(screen.getByTestId('settings-rail'));
    const panel = styleTextOf(screen.getByTestId('settings-panel'));

    expect(rail).toContain('overflow-y:auto');
    expect(panel).toContain('overflow-y:auto');
    // Without this a flex child will not shrink below its content, so the
    // overflow above never engages and the page scrolls after all.
    expect(rail).toContain('min-height:0');
    expect(panel).toContain('min-height:0');
  });

  it('leaves the page scrolling by default, so an upgrade changes nothing', () => {
    renderLayout(undefined);

    expect(styleTextOf(screen.getByTestId('settings-rail'))).not.toContain('overflow-y:auto');
    expect(styleTextOf(screen.getByTestId('settings-panel'))).not.toContain('overflow-y:auto');
    // The area still renders — this is the shape every current consumer gets.
    expect(screen.getByTestId('panel-child')).toBeInTheDocument();
  });
});
