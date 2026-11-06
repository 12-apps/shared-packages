// @vitest-environment jsdom
/**
 * A month's `flex` (FUT-4486). The basis was written as `1 1 ${sxRem(280)}`,
 * which interpolates a theme FUNCTION into the string: Emotion emitted the
 * function's source as the value, a browser drops that declaration as invalid,
 * and every month lost its 280 design px basis. jsdom's computed style drops it
 * too, so this reads the rule Emotion emitted for the month's own class.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ThemeProvider, createTheme } from '../../../../mui/styles';
import { Calendar } from '../Calendar';

/** Every `flex` declaration Emotion emitted for one of the element's own classes. */
function emittedFlex(element: Element): string[] {
  const css = [...document.querySelectorAll('style')].map((tag) => tag.textContent ?? '').join('\n');
  const own = [...element.classList].filter((name) => name.startsWith('css-'));
  return css
    .split('}')
    .filter((block) => own.some((name) => block.trimStart().startsWith(`.${name}{`)))
    .flatMap((block) => block.slice(block.indexOf('{') + 1).split(';'))
    .filter((declaration) => declaration.startsWith('flex:'))
    .map((declaration) => declaration.slice('flex:'.length));
}

describe('Calendar month flex basis (FUT-4486)', () => {
  it.each([
    ['the default type scale', createTheme()],
    ['a compact type scale', createTheme({ typography: { fontSize: 12 } })],
  ])('emits a valid 280 design px basis under %s', (_scale, theme) => {
    render(
      <ThemeProvider theme={theme}>
        <Calendar ariaLabel="Datas" value={new Date(2026, 0, 15)} locale="pt-BR" />
      </ThemeProvider>,
    );

    const month = screen.getByTestId('calendar-month-0');
    expect(emittedFlex(month)).toEqual([`1 1 ${theme.typography.pxToRem(280)}`]);
    expect(getComputedStyle(month).flex).toBe(`1 1 ${theme.typography.pxToRem(280)}`);
  });
});
