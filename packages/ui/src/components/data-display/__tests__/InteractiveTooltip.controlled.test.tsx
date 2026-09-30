/**
 * `InteractiveTooltip` stays a CONTROLLED MUI Tooltip from its first render
 * (FUT-3013). It used to pass `open={undefined}` until pinned and a boolean
 * after, and MUI logs "A component is changing the uncontrolled open state of
 * Tooltip to be controlled" the moment somebody clicks the trigger.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { InteractiveTooltip } from '../InteractiveTooltip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('pins without MUI reporting a switch to controlled', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <InteractiveTooltip hoverContent="Brief" pinnedContent="Whole text" dataTestId="tip">
      <button type="button">i</button>
    </InteractiveTooltip>,
  );

  fireEvent.click(screen.getByRole('button'));

  const switched = errors.mock.calls.filter((call) => String(call[0]).includes('uncontrolled open state'));
  expect(switched).toEqual([]);
});

it('still opens on hover', async () => {
  render(
    <InteractiveTooltip hoverContent="Brief" pinnedContent="Whole text" dataTestId="tip">
      <button type="button">i</button>
    </InteractiveTooltip>,
  );

  fireEvent.mouseOver(screen.getByRole('button'));
  expect(await screen.findByTestId('tip-content')).toHaveTextContent('Brief');
});
