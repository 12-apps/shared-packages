import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog, DialogActions, DialogContent } from '../index';

const paper = () => screen.getByRole('dialog');

describe('Dialog bottom-sheet (web)', () => {
  it('anchors a content-height paper at the bottom while preserving size, corners and inset', () => {
    render(<Dialog open variant="bottom-sheet" size="xs" borderRadius="xl"><DialogContent>Body</DialogContent></Dialog>);
    const style = getComputedStyle(paper());
    expect(style.marginTop).toBe('auto');
    expect(style.marginBottom).toBe('16px');
    expect(style.marginLeft).toBe('16px');
    expect(style.borderRadius).toBe('24px');
    expect(style.maxWidth).toBe('25rem');
    expect(style.height).not.toBe('100%');
    expect(paper()).toHaveAttribute('aria-modal', 'true');
  });

  it('retains the centered layout for the default variant', () => {
    render(<Dialog open><DialogContent>Body</DialogContent></Dialog>);
    expect(getComputedStyle(paper()).marginTop).toBe('16px');
  });

  it('focuses inside the sheet, dismisses on Escape and merges caller paper props', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open variant="bottom-sheet" title="Confirm" onClose={onClose} showCloseButton={false}
        PaperProps={{ className: 'caller-paper' }}>
        <DialogContent>Body</DialogContent>
        <DialogActions><button>Continue</button></DialogActions>
      </Dialog>,
    );
    expect(paper()).toHaveClass('caller-paper');
    await waitFor(() => expect(paper()).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(paper(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryAllByTestId('dialog-close')).toHaveLength(0);
  });

  it('preserves backdrop dismissal and persistence', () => {
    const onClose = vi.fn();
    const sheet = (persistent: boolean) => (
      <Dialog open variant="bottom-sheet" onClose={onClose} persistent={persistent}><DialogContent>Body</DialogContent></Dialog>
    );
    const { rerender } = render(sheet(false));
    const container = () => document.querySelector('.MuiDialog-container') as HTMLElement;
    fireEvent.mouseDown(container());
    fireEvent.click(container());
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
    rerender(sheet(true));
    fireEvent.mouseDown(container());
    fireEvent.click(container());
    fireEvent.keyDown(paper(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
