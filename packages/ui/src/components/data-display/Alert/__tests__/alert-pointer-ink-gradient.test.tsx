/**
 * A HOST-REPAINTED GRADIENT KEEPS ITS INK UNDER THE POINTER (FUT-4506).
 *
 * In a file of its own because Emotion's sheet is per FILE (see
 * `pointer-states.helpers.tsx`): rendering only gradients here makes "no step
 * in the sheet" a question about gradients alone.
 *
 * A host that repaints every alert — a light pane, a dark ink at `&&` — repaints
 * the gradient too. The gradient's tint layer is BLACK in both modes, so the
 * only ink step that could help that dark ink is toward black; the first cut of
 * option C read the side from the package's own WHITE `getContrastText` ink and
 * stepped it toward white instead, to 1.02:1 pressed. The gradient is not
 * stepped at all now; its rest contrast is FUT-4516's.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTheme, ThemeProvider } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { createUiTheme } from '../../../../tokens/theme';
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
  it('emits no ink step in either mode, so the dark ink is never pushed toward white', () => {
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
    // …and it carries no step of the message's ink.
    expect(css).not.toContain('color-mix(');
  });
});
