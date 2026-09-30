/**
 * A CALLER'S BACKDROP PROPS ADD TO THE DIALOG'S SCRIM — by every spelling MUI
 * takes them in.
 *
 * The Dialog draws its scrim (`backdropSxOf`: 0.5, or 0.2 behind a blur when
 * `glass` is set) on MUI's backdrop. It used to hand it over through the
 * deprecated `BackdropProps` and spread the caller's props after it, so a
 * caller's `BackdropProps` replaced it whole — and a caller's
 * `slotProps.backdrop`, which MUI puts over `BackdropProps`, did the same one
 * level down. A caller asking for one class lost the glass scrim (FUT-2672).
 * This is the backdrop half of FUT-2613's paper merge; see
 * `dialog-paper-props.test.tsx`.
 *
 * jsdom does not compute `backdrop-filter`, so the blur is checked in a browser
 * (`GlassBackdropKeepsItsBlur` in `Dialog.test.stories.tsx`).
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent } from '../index';

afterEach(cleanup);

const GLASS_SCRIM = 'rgba(0, 0, 0, 0.2)';
const PLAIN_SCRIM = 'rgba(0, 0, 0, 0.5)';

const CALLER_BACKDROP = { className: 'caller-backdrop', sx: { zIndex: 5 } } as const;

const backdropOf = (): HTMLElement => {
  const backdrop = document.querySelector<HTMLElement>('.MuiBackdrop-root');
  if (!backdrop) throw new Error('no backdrop rendered');
  return backdrop;
};

describe('Dialog backdrop props', () => {
  it("keeps the glass scrim under a caller's BackdropProps, and applies the caller's too", () => {
    render(
      <Dialog open glass BackdropProps={CALLER_BACKDROP}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const backdrop = backdropOf();
    const style = getComputedStyle(backdrop);
    expect(backdrop).toHaveClass('caller-backdrop');
    expect(style.zIndex).toBe('5');
    expect(style.backgroundColor).toBe(GLASS_SCRIM);
  });

  it("keeps the glass scrim under a caller's slotProps.backdrop, and applies the caller's too", () => {
    render(
      <Dialog open glass slotProps={{ backdrop: CALLER_BACKDROP }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const backdrop = backdropOf();
    const style = getComputedStyle(backdrop);
    expect(backdrop).toHaveClass('caller-backdrop');
    expect(style.zIndex).toBe('5');
    expect(style.backgroundColor).toBe(GLASS_SCRIM);
  });

  it('calls a function slotProps.backdrop and merges what it returns', () => {
    render(
      <Dialog open glass slotProps={{ backdrop: () => ({ className: 'caller-backdrop' }) }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const backdrop = backdropOf();
    expect(backdrop).toHaveClass('caller-backdrop');
    expect(getComputedStyle(backdrop).backgroundColor).toBe(GLASS_SCRIM);
  });

  it('merges slotProps.backdrop over BackdropProps when a caller passes both', () => {
    render(
      <Dialog
        open
        glass
        BackdropProps={{ sx: { zIndex: 5 } }}
        slotProps={{ backdrop: { sx: { zIndex: 6 } } }}
      >
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const style = getComputedStyle(backdropOf());
    expect(style.zIndex).toBe('6');
    expect(style.backgroundColor).toBe(GLASS_SCRIM);
  });

  it('draws the glass scrim with glass and the plain one without, when no backdrop props are passed', () => {
    const { unmount } = render(
      <Dialog open glass>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(getComputedStyle(backdropOf()).backgroundColor).toBe(GLASS_SCRIM);
    unmount();

    render(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(getComputedStyle(backdropOf()).backgroundColor).toBe(PLAIN_SCRIM);
  });
});
