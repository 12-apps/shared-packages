import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './Dialog.native';
import { dialogBackdrop, dialogLook, dialogRadius, type DialogLookArgs } from './Dialog.look.native';
import { DIALOG_MAX_WIDTH, DIALOG_PAPER_SHADOW } from './Dialog.metrics';
import {
  DialogActions,
  DialogContent,
  DialogHeader,
  dialogSubtitleStyle,
  dialogTitleStyle,
} from './DialogParts.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import type { UiShadow } from '../../../tokens/shadow';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `Modal` becomes the `[role="dialog"]`
 * overlay the shared stories query and the resolved style is what the browser
 * would paint. What is asserted is the NUMBERS — the same ones
 * `Dialog.styles.ts` derives its CSS from — and the structure.
 */
const theme = createUiTheme();

function look(over: Partial<DialogLookArgs> = {}): ReturnType<typeof dialogLook> {
  return dialogLook(theme, {
    variant: 'default',
    size: 'md',
    borderRadius: 'lg',
    glass: false,
    glow: false,
    pulse: false,
    ...over,
  });
}

const shadows = (style: { boxShadow?: unknown }): UiShadow[] => style.boxShadow as UiShadow[];

describe('Dialog (native)', () => {
  it('renders nothing until it is open, then a modal dialog', () => {
    const { rerender } = render(
      <Dialog open={false} dataTestId="d">
        <DialogContent>corpo</DialogContent>
      </Dialog>,
    );
    // Counted rather than asserted absent: nothing was removed, the modal was
    // simply never mounted, and the flakiness gate reads a `queryBy` absence
    // check as an unguarded wait for a removal.
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(screen.queryAllByTestId('d')).toHaveLength(0);

    rerender(
      <Dialog open dataTestId="d">
        <DialogContent dataTestId="d">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('d')).toBeInTheDocument();
    expect(screen.getByTestId('d-content')).toHaveTextContent('corpo');
  });

  it('sets the title as a level-2 heading, as MUI renders an h2', () => {
    render(
      <Dialog open title="Confirmar" dataTestId="d">
        <DialogContent>corpo</DialogContent>
      </Dialog>,
    );
    const heading = screen.getByRole('heading', { name: 'Confirmar' });
    expect(heading).toHaveAttribute('aria-level', '2');
  });

  it('titles itself, describes itself and offers a close button', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Excluir?" description="Não dá para desfazer." onClose={onClose} dataTestId="d">
        <DialogContent>corpo</DialogContent>
      </Dialog>,
    );

    expect(screen.getByTestId('d-title')).toHaveTextContent('Excluir?');
    expect(screen.getByTestId('d-title')).toHaveTextContent('Não dá para desfazer.');
    fireEvent.click(screen.getByTestId('d-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the close button when asked, and when there is nothing to close to', () => {
    const { rerender } = render(
      <Dialog open title="T" showCloseButton={false} onClose={vi.fn()} dataTestId="d">
        <DialogContent>x</DialogContent>
      </Dialog>,
    );
    expect(screen.queryAllByTestId('d-close')).toHaveLength(0);

    rerender(
      <Dialog open title="T" dataTestId="d">
        <DialogContent>x</DialogContent>
      </Dialog>,
    );
    expect(screen.queryAllByTestId('d-close')).toHaveLength(0);
  });

  it('closes on Escape unless it is persistent, which the stories only half cover', () => {
    // React Native routes Escape through `Modal`'s `onRequestClose`, which the
    // dialog hands `undefined` when persistent. `PersistentDialogTest` covers
    // the refusal; nothing covered the plain dialog answering it.
    // react-native-web listens for `keyup` on the document, not `keydown`.
    const onClose = vi.fn();
    const { unmount } = render(
      <Dialog open onClose={onClose} dataTestId="plain">
        <DialogContent>corpo</DialogContent>
      </Dialog>,
    );
    fireEvent.keyUp(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseFirm = vi.fn();
    render(
      <Dialog open persistent onClose={onCloseFirm} dataTestId="firm">
        <DialogContent>corpo</DialogContent>
      </Dialog>,
    );
    fireEvent.keyUp(document, { key: 'Escape', code: 'Escape' });
    expect(onCloseFirm).not.toHaveBeenCalled();
  });

  it('closes on a backdrop press unless it is persistent', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} dataTestId="d">
        <DialogContent>x</DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByTestId('d-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Dialog open persistent onClose={onClose} dataTestId="d">
        <DialogContent>x</DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByTestId('d-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sits on the paper at MUI elevation 24, capped at the size it was given', () => {
    const paper = look().paper;
    expect(paper.backgroundColor).toBe(theme.palette.background.paper);
    expect(paper.maxWidth).toBe(DIALOG_MAX_WIDTH.md);
    expect(paper.maxHeight).toBe('100%');
    expect(shadows(paper)).toEqual(DIALOG_PAPER_SHADOW);
    expect(look({ size: 'xs' }).paper.maxWidth).toBe(400);
    expect(look({ size: 'xl' }).paper.maxWidth).toBe(1200);
  });

  it('cuts every named radius to the web lengths', () => {
    expect(dialogRadius(theme, 'none')).toBe(0);
    expect(dialogRadius(theme, 'sm')).toBe(4);
    expect(dialogRadius(theme, 'md')).toBe(8);
    expect(dialogRadius(theme, 'lg')).toBe(16);
    expect(dialogRadius(theme, 'xl')).toBe(24);
  });

  it('paints glass, glow and the scrim with the web palette arithmetic', () => {
    const glass = look({ variant: 'glass' }).paper;
    expect(glass.backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
    expect(glass.borderColor).toBe('rgba(99, 102, 241, 0.2)');
    expect(shadows(glass)[0]).toMatchObject({ offsetY: 8, blurRadius: 32, color: 'rgba(0, 0, 0, 0.1)' });

    expect(shadows(look({ glow: true }).paper)).toEqual([
      { offsetX: 0, offsetY: 0, blurRadius: 40, spreadDistance: 0, color: 'rgba(99, 102, 241, 0.3)' },
    ]);
    // A glass paper declares its own shadow after the decorations, as the `sx` does.
    expect(shadows(look({ glow: true, variant: 'glass' }).paper)[0]).toMatchObject({ blurRadius: 32 });

    expect(dialogBackdrop(false).backgroundColor).toBe('rgba(0, 0, 0, 0.5)');
    expect(dialogBackdrop(true).backgroundColor).toBe('rgba(0, 0, 0, 0.2)');
  });

  it('fills the screen for fullscreen and pins the drawer to the right edge', () => {
    const full = look({ variant: 'fullscreen' });
    expect(full.paper).toMatchObject({ width: '100%', height: '100%', borderRadius: 0 });
    expect(full.overlay).toEqual({ flex: 1 });

    const drawer = look({ variant: 'drawer', size: 'sm' });
    expect(drawer.overlay.alignItems).toBe('flex-end');
    // Square, because the web's own `${radius}px 0 0 ${radius}px` is invalid CSS
    // and MUI's Drawer paper is `square`. See NATIVE-NOTES.md.
    expect(drawer.paper).toMatchObject({ width: 600, height: '100%', borderRadius: 0 });
  });

  it('pads raw children itself and stands back for the spacing slots', () => {
    render(
      <Dialog open dataTestId="raw">
        <span data-testid="bare">solto</span>
      </Dialog>,
    );
    // The wrapper is the paper's only child besides nothing: 24px each side.
    const bare = screen.getByTestId('bare');
    expect(bare.parentElement).toHaveStyle({ paddingLeft: '24px', paddingBottom: '20px' });

    render(
      <Dialog open dataTestId="slotted">
        <DialogContent dataTestId="slotted">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('slotted-content').parentElement).toBe(screen.getByTestId('slotted'));
  });

  it('tightens the body under a HEADER CHILD too, which is how every story writes it', () => {
    // The web's rule is a CSS sibling selector, so it fires however the title
    // arrived. Native reads a context, and it used to be set from the `title`
    // PROP alone — the one composition nothing uses. A header child took the
    // untitled 24px inset where the web gives 12px.
    render(
      <Dialog open dataTestId="d">
        <DialogHeader title="T" />
        <DialogContent dataTestId="d">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('d-content').firstElementChild).toHaveStyle({ paddingTop: '12px' });
  });

  it('tightens the body under a title and halves it when dense', () => {
    render(
      <Dialog open title="T" dataTestId="titled">
        <DialogContent dataTestId="titled">corpo</DialogContent>
      </Dialog>,
    );
    // The padding lives on the scroll view's content container.
    expect(screen.getByTestId('titled-content').firstElementChild).toHaveStyle({
      paddingTop: '12px',
      paddingLeft: '24px',
    });

    render(
      <Dialog open dataTestId="plain">
        <DialogContent dense dataTestId="plain">corpo</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('plain-content').firstElementChild).toHaveStyle({
      paddingTop: '12px',
      paddingLeft: '12px',
    });
  });

  it('aligns the actions and spaces them a unit apart', () => {
    render(
      <>
        <DialogActions dataTestId="right">a</DialogActions>
        <DialogActions alignment="space-between" spacing={2} dataTestId="spread">b</DialogActions>
      </>,
    );
    expect(screen.getByTestId('right-actions')).toHaveStyle({
      justifyContent: 'flex-end',
      padding: '16px',
      gap: '8px',
    });
    expect(screen.getByTestId('spread-actions')).toHaveStyle({
      justifyContent: 'space-between',
      gap: '16px',
    });
  });

  it('types the title and subtitle in MUI h6 and body2, and rules a custom header', () => {
    expect(dialogTitleStyle(theme).fontSize).toBe(20);
    expect(dialogSubtitleStyle(theme)).toMatchObject({
      fontSize: 14,
      color: theme.palette.text.secondary,
      marginTop: 4,
    });

    render(<DialogHeader dataTestId="custom">livre</DialogHeader>);
    expect(screen.getByTestId('custom-header')).toHaveStyle({
      padding: '16px',
      borderBottomWidth: '1px',
    });
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <Dialog open dataTestId="dark">
          <DialogContent>x</DialogContent>
        </Dialog>
      </UiProvider>,
    );
    expect(screen.getByTestId('dark')).toHaveStyle({ backgroundColor: 'rgb(18, 18, 18)' });
  });
});
