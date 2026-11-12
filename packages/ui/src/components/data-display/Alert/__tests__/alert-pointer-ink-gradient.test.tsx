/**
 * A HOST-REPAINTED GRADIENT STEPS ITS INK LIKE ANY OTHER ALERT (FUT-4506,
 * revised by FUT-4516).
 *
 * In a file of its own because Emotion's sheet is per FILE (see
 * `pointer-states.helpers.tsx`): rendering only gradients here makes "which
 * absolute the sheet steps toward" a question about gradients alone.
 *
 * A host that repaints every alert — a light pane, a dark ink at `&&` —
 * repaints the gradient too. While the gradient's ink side was unknown (white
 * `getContrastText`, a black layer in both modes) the variant was not stepped
 * at all, because the first cut stepped that dark ink toward white (1.02:1
 * pressed). The ink follows the mode now, and the tint is black in both modes
 * (owner decision, FUT-4516). Light mode steps toward black, as a semantic or
 * `glass` alert does under the same repaint: the dark ink goes darker, which
 * re-opens the gap under the black tint. Dark mode does not step: the tint
 * moves away from the white ink, so a host's dark ink is never pushed toward
 * white.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTheme, ThemeProvider } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { createUiTheme } from '../../../../tokens/theme';
import { blocksFor } from '../../__tests__/pointer-states.helpers';
import { Alert } from '../Alert';

/** A host's repaint, the shape a theme override paints every alert with: light pane, dark ink. */
const repainted = (mode: 'light' | 'dark') =>
  createTheme({
    ...muiThemeOptionsFrom(createUiTheme({ mode })),
    components: {
      MuiAlert: {
        styleOverrides: {
          root: { '&&': { color: '#3d2a00', backgroundColor: '#f4ead8', backgroundImage: 'none' } },
        },
      },
    },
  });

describe('Given a gradient Alert a host has repainted to a light pane and a dark ink', () => {
  it('steps the message ink toward black in light mode and not at all in dark mode', () => {
    for (const mode of ['light', 'dark'] as const) {
      render(
        <ThemeProvider theme={repainted(mode)}>
          <Alert variant="gradient" title="Atenção" description="mensagem" />
          <Alert variant="gradient">Só o texto, como filho.</Alert>
        </ThemeProvider>,
      );
    }
    const css = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    // The repaint landed, so the sheet is the one in question…
    expect(css).toContain('#3d2a00');
    // …and hover and press step the ink toward black in light mode. In dark
    // mode the gradient's tint is black, away from its white ink, so it does
    // not step at all and a host's dark ink is never pushed toward white.
    const stepped = [...blocksFor(css, ':hover'), ...blocksFor(css, ':active')].join('\n');
    expect(stepped).toContain('color-mix(in srgb, currentColor');
    expect(stepped).toContain(', #000)');
    expect(stepped).not.toContain(', #fff)');
  });
});
