/**
 * THE NATIVE GRADIENT HOLDS 4.5:1 TOO (FUT-4516).
 *
 * `gradientSurface` paints the first derived end at 0.9 under the mode's ink,
 * from the same arithmetic as the web (`Alert.gradient.core.ts`). Native draws
 * no shimmer and no hover or press on the alert itself (only its close button
 * presses), so rest is the one state it paints; the ends are still judged with
 * the web's stricter shimmer and tint. The title is at opacity 1, the
 * description at its own.
 */
import { describe, expect, it } from 'vitest';

import { blend, decomposeColor, getContrastRatio } from '../../../../tokens/color';
import { createUiTheme } from '../../../../tokens/theme';
import { alertPalette, alertSurface, DESCRIPTION, gradientSurface } from '../Alert.metrics';

const SEVERITIES = ['info', 'success', 'warning', 'danger', 'primary', 'secondary'] as const;
const MODES = ['light', 'dark'] as const;

/** The title and description contrast of the surface native paints, over the theme's paper. */
function painted(theme: ReturnType<typeof createUiTheme>, severity: (typeof SEVERITIES)[number]) {
  const { backgroundColor, color, iconColor } = gradientSurface(alertPalette(theme, severity), theme);
  const surface = blend(theme.palette.background.paper, backgroundColor, decomposeColor(backgroundColor).values[3] ?? 1);
  const inkAlpha = decomposeColor(color).values[3] ?? 1;
  const over = (opacity: number) => getContrastRatio(blend(surface, color, inkAlpha * opacity), surface);
  return { title: over(1), description: over(DESCRIPTION.opacity), color, iconColor };
}

describe.each(MODES)('Given a %s-mode native gradient Alert', (mode) => {
  const theme = createUiTheme({ mode });

  it.each(SEVERITIES)('holds the %s title and description at 4.5:1 or more', (severity) => {
    const { title, description } = painted(theme, severity);
    expect(title).toBeGreaterThanOrEqual(4.5);
    expect(description).toBeGreaterThanOrEqual(4.5);
  });

  it('takes the ink from the mode, as the web does, and the glyph follows it', () => {
    const { color, iconColor } = painted(theme, 'info');
    expect(color).toBe(mode === 'dark' ? '#fff' : theme.palette.text.primary);
    expect(iconColor).toBe(color);
  });

  it('is what alertSurface hands the renderer for the variant', () => {
    expect(alertSurface(theme, 'gradient', alertPalette(theme, 'info'))).toEqual(gradientSurface(theme.palette.info, theme));
  });
});

describe('Given a native theme with a host hue that is not the default', () => {
  it.each(['#00bfa5', '#fff176', '#7b1fa2'])('derives a passing %s surface from the theme', (main) => {
    for (const mode of MODES) {
      const theme = createUiTheme({ mode, palette: { info: { main } } });
      expect(painted(theme, 'info').description).toBeGreaterThanOrEqual(4.5);
      expect(painted(theme, 'info').title).toBeGreaterThanOrEqual(4.5);
    }
  });
});
