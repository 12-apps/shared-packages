/**
 * A SLIMMER CHIP MUST NOT MEAN A SMALLER TARGET.
 *
 * The strip sits between a section's header and its first field on the narrow
 * width, so the pill is drawn to its text (`34px`) rather than to a thumb. But
 * this strip IS the navigation at that width, and the input is a thumb — so the
 * tappable region stays at `TOUCH_TARGET` via an `::after` that reaches beyond
 * the painted box.
 *
 * That trick is invisible: delete the pseudo-element and the strip looks
 * identical while every chip quietly becomes 10px harder to hit. Nothing about
 * the rendered tree would change, which is exactly why the rule is asserted
 * here rather than left to review.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsSectionChips } from '../SettingsSectionChips';
import { TOUCH_TARGET } from '../SettingsLayout.styles';
import type { SettingsNavItem } from '../SettingsLayout.types';

const ITEMS: SettingsNavItem[] = [
  { id: 'branding', label: 'Perfil e marca', href: '#/config/branding' },
  { id: 'hours', label: 'Horários', href: '#/config/hours' },
];

/** A stylesheet's rules, or none where the browser refuses to expose them. */
function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return [];
  }
}

/** Every emotion rule that mentions one of the element's classes, whitespace out. */
function styleTextOf(el: HTMLElement): string {
  const classes = Array.from(el.classList);
  return Array.from(document.styleSheets)
    .flatMap((sheet) => rulesOf(sheet))
    .filter((rule) => classes.some((cls) => rule.cssText.includes(`.${cls}`)))
    .map((rule) => rule.cssText)
    .join('')
    .replace(/\s+/gu, '');
}

describe('the chip strip', () => {
  it('draws a short pill and still takes a full-size tap', () => {
    render(
      <SettingsSectionChips
        items={ITEMS}
        activeItemId="branding"
        ariaLabel="Configuração"
        linkComponent="a"
        testIdPrefix="settings"
      />,
    );

    const chip = styleTextOf(screen.getByTestId('settings-chip-hours'));

    // Drawn short…
    expect(chip).toContain('min-height:34px');
    // …and tapped at the full target, from a pseudo-element centred on the pill.
    expect(chip).toContain('::after');
    expect(chip).toContain(`height:${TOUCH_TARGET}px`);
    expect(chip).toContain('translateY(-50%)');
  });
});
