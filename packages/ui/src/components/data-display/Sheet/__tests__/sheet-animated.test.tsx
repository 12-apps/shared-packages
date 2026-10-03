/**
 * `animated={false}` opens a sheet at once: the drawer it renders gets a 0ms
 * transition. A host whose design draws its overlays without motion needs it
 * (FUT-3239). The drawer is stubbed to read the props the sheet hands it —
 * jsdom clears the slide's inline transition as soon as it ends.
 */
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const drawer = vi.hoisted(() => vi.fn());

vi.mock('@mui/material/Drawer/index.js', () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    drawer(props);
    return <div>{props.children}</div>;
  },
}));

const { Sheet } = await import('../Sheet');

afterEach(() => {
  cleanup();
  drawer.mockClear();
});

describe('Sheet animated', () => {
  it('leaves the drawer its own slide by default', () => {
    render(
      <Sheet open position="bottom" swipeable={false}>
        Body
      </Sheet>,
    );
    expect(drawer).toHaveBeenLastCalledWith(expect.not.objectContaining({ transitionDuration: 0 }));
  });

  it('hands the drawer a 0ms transition with animated={false}', () => {
    render(
      <Sheet open position="bottom" swipeable={false} animated={false}>
        Body
      </Sheet>,
    );
    expect(drawer).toHaveBeenLastCalledWith(expect.objectContaining({ transitionDuration: 0 }));
  });
});
