import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Separator } from '../Separator';

// FUT-2617: a labelled vertical separator is a column (rule, label, rule). With
// no `length` each rule was `height: 100%` of a column as tall as its content,
// so both drew 0px. jsdom does not lay out, so this pins the styles that make
// the column stretch and the rules share it; the geometry itself is proven by
// the `VerticalLabelledRules` story.
const theme = createTheme();

function renderSeparator(length?: string) {
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

describe('a labelled vertical Separator (FUT-2617)', () => {
  it('without a length, stretches its column and lets both rules share it', () => {
    const { group, rules } = renderSeparator();
    expect(style(group).alignSelf).toBe('stretch');
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(style(rule).flexGrow).toBe('1');
      expect(style(rule).flexBasis).toMatch(/^0(px|%)?$/);
      expect(style(rule).minHeight).toBe('1rem');
    }
  });

  it('with a length, draws each rule exactly that long and keeps the column unstretched', () => {
    const { group, rules } = renderSeparator('80px');
    expect(style(group).alignSelf).not.toBe('stretch');
    for (const rule of rules) {
      expect(style(rule).flexGrow).toBe('0');
      expect(style(rule).flexShrink).toBe('0');
      expect(style(rule).height).toBe('80px');
    }
  });
});
