/**
 * The sheet's close button is an icon alone, so its name has to be given: it
 * had none at all, and a screen reader announced a bare "button". It now
 * reads the caller's `closeLabel`, and `close` when the caller names nothing —
 * the same default the Dialog's close button has.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PT_BR_UI_LABELS } from '../../../../pt-BR.labels';
import { Sheet } from '../Sheet';

afterEach(cleanup);

describe('the sheet close button', () => {
  it("is named by the caller's closeLabel", () => {
    render(
      <Sheet open position="bottom" title="Carrinho" closeLabel={PT_BR_UI_LABELS.common.close} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByTestId('s-header-close-button')).toHaveAccessibleName(PT_BR_UI_LABELS.common.close);
  });

  it('is named close when the caller names nothing', () => {
    render(
      <Sheet open position="bottom" title="Cart" dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'close' })).toBe(screen.getByTestId('s-header-close-button'));
  });
});
