/**
 * `controlled`: a close only asks (FUT-4478).
 *
 * A host that may refuse a close — a form asking "leave without saving?" —
 * answers `onOpenChange(false)` by keeping `open` true. Without `controlled`
 * the sheet had already hidden itself, so on a phone the question appeared
 * over a sheet that was gone, and the form could not be reached again.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet } from '../Sheet';

afterEach(cleanup);

function Guarded({ refuse, onAsk }: { refuse: boolean; onAsk: () => void }): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      open={open}
      controlled
      position="bottom"
      dataTestId="s"
      onOpenChange={(next) => {
        onAsk();
        if (!next && !refuse) setOpen(false);
      }}
    >
      <p>body</p>
    </Sheet>
  );
}

describe('a controlled sheet', () => {
  it('stays open when the host refuses the close', async () => {
    const onAsk = vi.fn();
    render(<Guarded refuse onAsk={onAsk} />);
    fireEvent.click(screen.getByTestId('s-click-catcher'));
    expect(onAsk).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('body')).toBeVisible());
  });

  it('closes when the host agrees', async () => {
    const onAsk = vi.fn();
    render(<Guarded refuse={false} onAsk={onAsk} />);
    fireEvent.click(screen.getByTestId('s-click-catcher'));
    expect(onAsk).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('body')).not.toBeVisible());
  });
});
