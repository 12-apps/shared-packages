/**
 * The default tooltip is OPAQUE (FUT-3093).
 *
 * It opens over the very text it explains — a settings card's ⓘ sits on the
 * card's own summary — so a see-through bubble put the summary's words under
 * the tooltip's words: text on text. `glass` stays translucent on purpose (it
 * blurs what is behind it); the default may not.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tooltip } from '../../Tooltip';
import { InteractiveTooltip } from '../InteractiveTooltip';
import { arrowColor, variantStyles } from '../InteractiveTooltip.styles';

const theme = createTheme();

afterEach(cleanup);

/** An `rgba(...)`/`#rrggbbaa` with alpha below 1 is see-through; anything else paints solid. */
function isOpaque(color: string): boolean {
  const rgba = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);
  if (rgba) return Number(rgba[1]) >= 1;
  return !/^#[0-9a-f]{8}$/i.test(color) || color.slice(7).toLowerCase() === 'ff';
}

describe('the default tooltip is opaque', () => {
  it('paints the InteractiveTooltip bubble and its arrow solid', () => {
    expect(isOpaque(String(variantStyles(theme, 'default').backgroundColor))).toBe(true);
    expect(isOpaque(arrowColor(theme, 'default'))).toBe(true);
  });

  it('keeps glass translucent, which it is on purpose', () => {
    expect(isOpaque(String(variantStyles(theme, 'glass').backgroundColor))).toBe(false);
  });

  it('paints the InteractiveTooltip bubble solid, the one behind a settings card ⓘ', () => {
    render(
      <InteractiveTooltip hoverContent="O texto completo" open>
        <span>ⓘ</span>
      </InteractiveTooltip>,
    );
    const bubble = document.querySelector<HTMLElement>('.MuiTooltip-tooltip');
    expect(bubble).not.toBeNull();
    const fill = getComputedStyle(bubble as HTMLElement).backgroundColor;
    expect(fill).not.toBe('');
    expect(isOpaque(fill)).toBe(true);
  });

  it('paints the Tooltip bubble solid', () => {
    render(
      <Tooltip title="O texto completo" open>
        <span>ⓘ</span>
      </Tooltip>,
    );
    // MUI renders the popper and the bubble inside it; the fill is the bubble's.
    const bubble = document.querySelector<HTMLElement>('.MuiTooltip-tooltip');
    expect(bubble).not.toBeNull();
    const fill = getComputedStyle(bubble as HTMLElement).backgroundColor;
    expect(fill).not.toBe('');
    expect(isOpaque(fill)).toBe(true);
  });
});
