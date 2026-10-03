/**
 * `animated={false}` opens the picker at once, on both of its surfaces: the
 * dialog (wide) and the bottom drawer (narrow) each get a 0ms transition
 * (FUT-3239). Both are stubbed to read the props the picker hands them.
 */
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const surfaces = vi.hoisted(() => ({ dialog: vi.fn(), drawer: vi.fn(), narrow: vi.fn(() => false) }));

vi.mock('@mui/material/Dialog/index.js', () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    surfaces.dialog(props);
    return <div>{props.children}</div>;
  },
}));

vi.mock('@mui/material/Drawer/index.js', () => ({
  default: (props: Record<string, unknown> & { children?: ReactNode }) => {
    surfaces.drawer(props);
    return <div>{props.children}</div>;
  },
}));

vi.mock('@mui/material/useMediaQuery/index.js', () => ({ default: () => surfaces.narrow() }));

const { PickerSheet } = await import('../PickerSheet');

afterEach(() => {
  cleanup();
  surfaces.dialog.mockClear();
  surfaces.drawer.mockClear();
  surfaces.narrow.mockReset();
  surfaces.narrow.mockReturnValue(false);
});

function renderPicker(animated?: boolean): void {
  render(
    <PickerSheet
      open
      onClose={vi.fn()}
      kicker="Product"
      title="Choose a category"
      searchPlaceholder="Search"
      searchLabel="Search"
      closeLabel="Close"
      items={[{ id: 'a', label: 'A', indent: 0 }]}
      onPick={vi.fn()}
      dataTestId="ps"
      animated={animated}
    />,
  );
}

describe('PickerSheet animated', () => {
  it('keeps the dialog its own fade by default', () => {
    renderPicker();
    expect(surfaces.dialog).toHaveBeenLastCalledWith(expect.not.objectContaining({ transitionDuration: 0 }));
  });

  it('opens the dialog at once with animated={false}', () => {
    renderPicker(false);
    expect(surfaces.dialog).toHaveBeenLastCalledWith(expect.objectContaining({ transitionDuration: 0 }));
  });

  it('opens the bottom drawer at once with animated={false}', () => {
    surfaces.narrow.mockReturnValue(true);
    renderPicker(false);
    expect(surfaces.drawer).toHaveBeenLastCalledWith(expect.objectContaining({ transitionDuration: 0 }));
  });
});
