/**
 * `animated={false}` reaches the veil too: a sheet that opens at once must not
 * fade its dim backdrop in over 300ms either (FUT-3239). Fade and Backdrop are
 * stubbed to read the timings the overlay hands them.
 */
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parts = vi.hoisted(() => ({ fade: vi.fn(), backdrop: vi.fn() }));

vi.mock('@mui/material/Fade/index.js', () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    parts.fade(props);
    return <>{props.children}</>;
  },
}));

vi.mock('@mui/material/Backdrop/index.js', () => ({
  default: (props: Record<string, unknown>) => {
    parts.backdrop(props);
    return <div />;
  },
}));

const { SheetOverlay } = await import('../Sheet.parts');

afterEach(() => {
  cleanup();
  parts.fade.mockClear();
  parts.backdrop.mockClear();
});

describe('SheetOverlay animated', () => {
  it('fades the veil over 300ms by default', () => {
    render(<SheetOverlay open />);
    expect(parts.fade).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 300 }));
    expect(parts.backdrop).toHaveBeenLastCalledWith(expect.objectContaining({ transitionDuration: 300 }));
  });

  it('shows the veil at once with animated={false}', () => {
    render(<SheetOverlay open animated={false} />);
    expect(parts.fade).toHaveBeenLastCalledWith(expect.objectContaining({ timeout: 0 }));
    expect(parts.backdrop).toHaveBeenLastCalledWith(expect.objectContaining({ transitionDuration: 0 }));
  });
});
