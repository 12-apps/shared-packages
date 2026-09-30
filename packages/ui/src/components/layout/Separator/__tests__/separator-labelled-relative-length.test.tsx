import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Separator } from '../Separator';
import { labelledSeparatorLayout } from '../Separator.styles';

// FUT-2675: a relative `length` on a labelled VERTICAL separator (a number of 1
// or less, or a percentage) set each rule to a percentage of a column as tall
// as its own content, which resolves to 0px. It now resolves against the
// separator's run, as on a labelled horizontal one: the column stretches to its
// row and each rule is that fraction of it, shrinking to leave the label room,
// never shorter than the 1rem minimum. jsdom does not lay out, so this pins the
// styles; the geometry is proven by the `VerticalLabelledRules` story.
const theme = createTheme();

function renderSeparator(length: string | number) {
  render(
    <ThemeProvider theme={theme}>
      <div style={{ display: 'flex', alignItems: 'center', height: 120 }}>
        <Separator orientation="vertical" length={length} data-testid="labelled">
          OR
        </Separator>
      </div>
    </ThemeProvider>,
  );
  const group = screen.getByTestId('labelled');
  const rules = Array.from(group.children).filter((el): el is HTMLElement => el.tagName === 'DIV');
  return { group, rules };
}

const style = (el: Element) => globalThis.getComputedStyle(el);

describe('a labelled vertical Separator with a relative length (FUT-2675)', () => {
  it.each<[string | number, string]>([
    ['25%', '25%'],
    [0.25, '25%'],
    ['50%', '50%'],
    [0.5, '50%'],
  ])('with length %s, stretches its column and draws each rule %s of it', (length, height) => {
    const { group, rules } = renderSeparator(length);
    expect(style(group).alignSelf).toBe('stretch');
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(style(rule).flexGrow).toBe('0');
      expect(style(rule).flexShrink).toBe('1');
      expect(style(rule).height).toBe(height);
      expect(style(rule).minHeight).toBe('1rem');
    }
  });

  it('keeps an absolute number exact and the column unstretched', () => {
    const { group, rules } = renderSeparator(80);
    expect(style(group).alignSelf).not.toBe('stretch');
    for (const rule of rules) {
      expect(style(rule).flexGrow).toBe('0');
      expect(style(rule).flexShrink).toBe('0');
    }
  });
});

describe('labelledSeparatorLayout for a horizontal separator (FUT-2675)', () => {
  it.each([undefined, '25%', 0.25, '80px', 80])('adds nothing with length %s', (length) => {
    expect(labelledSeparatorLayout(theme, true, length)).toEqual({ rule: {}, group: {} });
  });
});
