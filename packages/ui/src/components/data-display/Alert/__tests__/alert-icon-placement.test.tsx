/**
 * WHERE THE ICON SITS.
 *
 * `'gutter'` is every alert as it was: the icon in MUI's own slot, the words in
 * a column beside it. `'title'` puts the icon on the title's line, so the
 * description starts at the alert's edge. A HOST picks it once, on its theme
 * (`uiAlert.iconPlacement`); a call site may still override it.
 */
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, within } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it } from 'vitest';

import { Alert } from '../Alert';

const TITLE = 'Esta loja entrega no seu CEP';
const BODY = 'A taxa de entrega aparece no checkout, com o endereço completo.';

const rendered = (ui: React.ReactElement, placement?: 'gutter' | 'title'): HTMLElement => {
  const theme = createTheme(placement ? { uiAlert: { iconPlacement: placement } } : {});
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>).getByTestId('alert');
};

const iconSlot = (root: HTMLElement): Element | null => root.querySelector('.MuiAlert-icon');
/** How many elements carry this test id — 0 is an assertion, not a missed query. */
const count = (root: HTMLElement, testId: string): number =>
  root.querySelectorAll(`[data-testid="${testId}"]`).length;

describe('Given an alert under a theme that states nothing', () => {
  it('then the icon keeps its own column, as before', () => {
    const root = rendered(<Alert variant="success" title={TITLE} description={BODY} />);

    expect(iconSlot(root)).toContainElement(within(root).getByTestId('alert-icon'));
    expect(count(root, 'alert-title-row')).toBe(0);
  });
});

describe("Given a theme that puts the icon on the title's line", () => {
  it('then the icon shares a row with the title, and the description is outside that row', () => {
    const root = rendered(<Alert variant="success" title={TITLE} description={BODY} />, 'title');

    const row = within(root).getByTestId('alert-title-row');
    expect(row).toContainElement(within(root).getByTestId('alert-icon'));
    expect(row).toContainElement(within(root).getByTestId('alert-title'));
    expect(row).not.toContainElement(within(root).getByTestId('alert-message'));
    expect(root.querySelectorAll('.MuiAlert-icon')).toHaveLength(0);
  });

  it('then an alert with no title keeps the icon in its column — there is no title line', () => {
    const root = rendered(<Alert variant="info" description={BODY} />, 'title');

    expect(iconSlot(root)).toContainElement(within(root).getByTestId('alert-icon'));
    expect(count(root, 'alert-title-row')).toBe(0);
  });

  it('then an alert that hides its icon draws no row for it', () => {
    const root = rendered(<Alert variant="info" title={TITLE} showIcon={false} />, 'title');

    expect(count(root, 'alert-title-row')).toBe(0);
    expect(count(root, 'alert-icon')).toBe(0);
  });

  it('then a call site that asks for the gutter still gets it', () => {
    const root = rendered(
      <Alert variant="warning" title={TITLE} description={BODY} iconPlacement="gutter" />,
      'title',
    );

    expect(iconSlot(root)).toContainElement(within(root).getByTestId('alert-icon'));
  });

  it('then the prop never reaches the DOM', () => {
    const root = rendered(<Alert variant="info" title={TITLE} iconPlacement="title" />);

    expect(root).not.toHaveAttribute('iconPlacement');
    expect(root).not.toHaveAttribute('iconplacement');
  });
});
