// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTheme, ThemeProvider } from '@12-apps/ui/mui/styles';

import { TOAST_DURATION_MS, createToastStore, createToaster } from '../core';
import { Toast, ToastHost, ToastPortal, ToastSurface, inverseColors } from '../react';

/**
 * The column as a host mounts it: one `ToastHost`, toasts raised from outside
 * React, and declarative toasts rendered by the host. The copy is a made-up
 * shop's so nothing leans on an adopter's words.
 */

const WORDS = { dismissLabel: 'Close it', moreLabel: (n: number) => `${n} more waiting` };

function mount(store = createToastStore(), max?: number) {
  const toaster = createToaster(store);
  const view = render(<ToastHost {...WORDS} store={store} max={max} />);
  return { ...view, toaster, store };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToastHost', () => {
  it('draws a raised toast in the column at the top of the screen', () => {
    const { toaster } = mount();
    act(() => {
      toaster.success('Saved', { testId: 'saved' });
    });

    const viewport = screen.getByTestId('toast-viewport');
    expect(within(viewport).getByTestId('saved-message').textContent).toBe('Saved');
    // Under <body>, not where the host was mounted: a fixed column inside a
    // transformed shell would be positioned against the shell.
    expect(viewport.parentElement).toBe(document.body);
    expect(getComputedStyle(viewport).position).toBe('fixed');
    expect(getComputedStyle(viewport).bottom).not.toBe('');
  });

  it('paints the inverse surface: near-black on a light theme', () => {
    const theme = createTheme();
    const store = createToastStore();
    render(
      <ThemeProvider theme={theme}>
        <ToastHost {...WORDS} store={store} />
      </ThemeProvider>,
    );
    act(() => {
      createToaster(store)('Hello', { testId: 'hello' });
    });
    const { ground, ink } = inverseColors(theme);
    const card = screen.getByTestId('hello');
    expect(ground).toBe(theme.palette.grey[900]);
    expect(getComputedStyle(card).backgroundColor).toBe(hexToRgb(ground));
    expect(ink).toBe('#fff');
    expect(getComputedStyle(card).color).toBe('rgb(255, 255, 255)');
  });

  it('turns over on a dark theme: a light card', () => {
    const theme = createTheme({ palette: { mode: 'dark' } });
    expect(inverseColors(theme).ground).toBe(theme.palette.grey[100]);
  });

  it('leaves on its own after its lifetime, and not before', () => {
    const { toaster } = mount();
    const onDismiss = vi.fn();
    act(() => {
      toaster('Moved', { testId: 'moved', onDismiss });
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByTestId('moved')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('moved')).toBeNull();
    expect(onDismiss).toHaveBeenCalledWith('timeout');
  });

  it('stops the clock while the pointer is on it', () => {
    const { toaster } = mount();
    act(() => {
      toaster('Read me', { testId: 'read' });
    });
    fireEvent.mouseEnter(screen.getByTestId('read').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(screen.getByTestId('read')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByTestId('read').parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByTestId('read')).toBeNull();
  });

  it('keeps a persistent toast until it is closed, and names the close button', () => {
    const { toaster } = mount();
    const onDismiss = vi.fn();
    act(() => {
      toaster.error('Not saved', { testId: 'err', duration: null, onDismiss });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const close = screen.getByRole('button', { name: 'Close it' });
    fireEvent.click(close);
    expect(screen.queryByTestId('err')).toBeNull();
    expect(onDismiss).toHaveBeenCalledWith('close');
  });

  it('runs an action and leaves, unless the action keeps it open', () => {
    const { toaster } = mount();
    const undo = vi.fn();
    const peek = vi.fn();
    act(() => {
      toaster('Moved', {
        testId: 'moved',
        actions: [
          { label: 'Undo', onClick: undo, testId: 'undo' },
          { label: 'Peek', onClick: peek, keepOpen: true, testId: 'peek' },
        ],
      });
    });
    fireEvent.click(screen.getByTestId('peek'));
    expect(peek).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('moved')).toBeTruthy();
    fireEvent.click(screen.getByTestId('undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('moved')).toBeNull();
  });

  it('draws a disabled action as disabled', () => {
    const { toaster } = mount();
    act(() => {
      toaster('Moved', { actions: [{ label: 'Undo', onClick: vi.fn(), disabled: true, testId: 'undo' }] });
    });
    expect((screen.getByTestId('undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('draws the newest toast first and says how many wait beyond the cap', () => {
    const { toaster } = mount(createToastStore(), 2);
    act(() => {
      toaster('one', { testId: 't1' });
      toaster('two', { testId: 't2' });
      toaster('three', { testId: 't3' });
    });
    const viewport = screen.getByTestId('toast-viewport');
    const drawn = within(viewport)
      .getAllByTestId(/^t\d$/)
      .map((node) => node.getAttribute('data-testid'));
    expect(drawn).toEqual(['t3', 't2']);
    expect(screen.getByTestId('toast-more').textContent).toBe('1 more waiting');
  });

  it('announces an error assertively and everything else politely', () => {
    const { toaster } = mount();
    act(() => {
      toaster.error('Refused', { testId: 'err' });
      toaster('Fine', { testId: 'ok' });
    });
    expect(screen.getByRole('alert').textContent).toContain('Refused');
    const polite = screen.getByTestId('toast-viewport').querySelector('[aria-live="polite"]');
    expect(polite?.textContent).toContain('Fine');
  });

  it('shows a spinner for a loading toast and no close button when not dismissible', () => {
    const { toaster } = mount();
    act(() => {
      toaster.loading('Sending', { testId: 'load', dismissible: false });
    });
    expect(screen.getByTestId('toast-spinner')).toBeTruthy();
    expect(screen.queryByTestId('load-close')).toBeNull();
  });
});

describe('declarative toasts', () => {
  it('portals a host body into the same column, under the queue', () => {
    const store = createToastStore();
    render(
      <ToastHost {...WORDS} store={store}>
        <ToastPortal>
          <ToastSurface testId="receipt">My own body</ToastSurface>
        </ToastPortal>
      </ToastHost>,
    );
    const slot = screen.getByTestId('toast-slot');
    expect(within(slot).getByTestId('receipt').textContent).toBe('My own body');
    expect(screen.getByTestId('receipt').getAttribute('data-ui-overlay')).toBe('');
  });

  it('stands alone in the same place when no host is mounted', () => {
    render(
      <ToastPortal>
        <span data-testid="alone">x</span>
      </ToastPortal>,
    );
    const column = screen.getByTestId('toast-viewport-standalone');
    expect(within(column).getByTestId('alone')).toBeTruthy();
    expect(getComputedStyle(column).position).toBe('fixed');
  });

  it('draws the packaged card while open, asks to leave on time, and takes live props', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ToastHost {...WORDS} store={createToastStore()}>
        <Toast
          open
          message="Moved"
          onClose={onClose}
          testId="live"
          actions={[{ label: 'Undo', onClick: vi.fn(), disabled: true, testId: 'live-undo' }]}
        />
      </ToastHost>,
    );
    expect((screen.getByTestId('live-undo') as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <ToastHost {...WORDS} store={createToastStore()}>
        <Toast
          open
          message="Moved"
          onClose={onClose}
          testId="live"
          actions={[{ label: 'Undo', onClick: vi.fn(), testId: 'live-undo' }]}
        />
      </ToastHost>,
    );
    expect((screen.getByTestId('live-undo') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Close it' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(onClose).toHaveBeenCalledWith('timeout');
  });

  it('draws nothing while closed', () => {
    render(<Toast open={false} message="x" onClose={vi.fn()} testId="shut" />);
    expect(screen.queryByTestId('shut')).toBeNull();
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
