/**
 * A CALLER'S `PaperProps` DROPPED THE STYLED PAPER (FUT-3200).
 *
 * `Popover` composed its own `PaperProps` — the styled paper, its variant and
 * the width cap — and then spread every remaining prop after it, so a caller
 * passing `PaperProps` (to give the surface a border, say) replaced the whole
 * object: the paper lost its variant styling and its cap without a word. The
 * caller's paper props are now merged in, and its `sx` is added to the cap.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Popover } from '../Popover';

function anchor(): HTMLElement {
  const element = document.createElement('button');
  document.body.appendChild(element);
  return element;
}

describe('Popover — a caller-styled paper', () => {
  it("keeps the styled paper and its cap, and adds the caller's sx and attributes", () => {
    render(
      <Popover
        open
        anchorEl={anchor()}
        maxWidth={300}
        PaperProps={{ sx: { borderWidth: '3px', borderStyle: 'solid' }, 'data-testid': 'caller-paper' } as never}
      >
        content
      </Popover>,
    );
    const paper = screen.getByTestId('caller-paper');
    const style = getComputedStyle(paper);
    expect(style.borderWidth).toBe('3px');
    // The cap is the component's own, in rem (`popoverCap`); MUI's default
    // paper — what a dropped styled paper falls back to — caps in a calc().
    expect(style.maxWidth).toMatch(/rem$/);
  });
});
