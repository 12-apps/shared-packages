/**
 * A TEXTAREA OPENS AT FOUR LINES OF ITS OWN TEXT, AND A SCREEN MAY ASK FOR MORE
 * OR FEWER (FUT-3534).
 *
 * The box's height used to be a per-size pixel `minHeight` (80px at `sm`) that
 * ignored the font, and `minRows` reached only the `autosize` variant. Worse,
 * `TextareaAutosize` measures one row on a hidden copy carrying the same class,
 * so with the floor a "row" measured as the whole floor and `minRows={2}` drew
 * about 200px (FUT-3504). Callers hand-picked `minRows` that the floor then
 * overrode.
 *
 * jsdom lays nothing out, so this reads what the browser is handed: the
 * `rows` attribute `TextareaAutosize` writes from `minRows`, and the field's
 * computed style.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { afterEach, describe, expect, it } from 'vitest';

import { Textarea } from '../Textarea';

afterEach(cleanup);

const theme = createTheme();

const rowsOf = (testId: string): number =>
  (screen.getByTestId(testId) as HTMLTextAreaElement).rows;

describe('the textarea height', () => {
  it.each(['default', 'autosize', 'resizable'] as const)(
    'opens a %s textarea at four lines',
    (variant) => {
      render(
        <ThemeProvider theme={theme}>
          <Textarea aria-label="Observação" variant={variant} data-testid="note" />
        </ThemeProvider>,
      );
      expect(rowsOf('note')).toBe(4);
    },
  );

  it('takes the height a screen asks for', () => {
    render(
      <ThemeProvider theme={theme}>
        <Textarea aria-label="Texto do cupom" variant="autosize" minRows={1} data-testid="short" />
        <Textarea aria-label="Resposta" minRows={6} data-testid="tall" />
      </ThemeProvider>,
    );
    expect(rowsOf('short')).toBe(1);
    expect(rowsOf('tall')).toBe(6);
  });

  it.each(['xs', 'sm', 'md', 'lg', 'xl'] as const)(
    'puts no pixel floor under a %s textarea, so a row is a line of its text',
    (size) => {
      render(
        <ThemeProvider theme={theme}>
          <Textarea aria-label="Observação" size={size} data-testid="note" />
        </ThemeProvider>,
      );
      // Computed, not the CSS this render added: emotion emits a class once,
      // so a size an earlier test already drew would add nothing to read.
      expect(getComputedStyle(screen.getByTestId('note')).minHeight).toBe('');
    },
  );
});
