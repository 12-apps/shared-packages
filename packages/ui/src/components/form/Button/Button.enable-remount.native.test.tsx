import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { Platform } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, enableFlipKey } from './Button.native';

/**
 * An Android Button is a NEW view when it turns enabled or disabled
 * (FUT-3775). There, a disabled solid Button that turned enabled painted its
 * fill and no label — the courier app's cancel, join and finish sheets showed a
 * red block with no text. Measured on the future-pay Maestro emulator lane: a
 * remount of the label alone did not bring it back; remounting the button did.
 * Only Android, and only the disabled flip: a remount loses screen-reader focus.
 */
const realOs = Platform.OS;

/** Run the render as Android: the remount is Android's alone. */
function asAndroid(): void {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: realOs, configurable: true });
});

function Confirm({ ready, busy = false, label = 'Confirmar' }: { ready: boolean; busy?: boolean; label?: string }): React.JSX.Element {
  return (
    <Button variant="solid" color="danger" disabled={!ready} loading={busy} dataTestId="confirm">
      {label}
    </Button>
  );
}

describe('enableFlipKey', () => {
  it('keys an Android button on whether it is disabled', () => {
    expect(enableFlipKey(true, 'android')).toBe('disabled');
    expect(enableFlipKey(false, 'android')).toBe('enabled');
    expect(enableFlipKey(undefined, 'android')).toBe('enabled');
  });

  it('gives iOS and the web no key — they keep their view, and screen-reader focus', () => {
    expect(enableFlipKey(true, 'ios')).toBeUndefined();
    expect(enableFlipKey(false, 'web')).toBeUndefined();
  });
});

describe('Button (native, Android) — the enable flip', () => {
  it('mounts a new view when the button turns enabled', () => {
    asAndroid();
    const { rerender } = render(<Confirm ready={false} />);
    const disabled = screen.getByTestId('confirm');

    rerender(<Confirm ready />);

    expect(screen.getByTestId('confirm')).not.toBe(disabled);
    expect(screen.getByTestId('confirm')).toHaveTextContent('Confirmar');
  });

  it('keeps its view while loading starts and settles — the user just pressed it', () => {
    asAndroid();
    const { rerender } = render(<Confirm ready />);
    const idle = screen.getByTestId('confirm');

    rerender(<Confirm ready busy />);
    expect(screen.getByTestId('confirm')).toBe(idle);
    rerender(<Confirm ready />);

    expect(screen.getByTestId('confirm')).toBe(idle);
  });

  it('keeps its view when a press makes it busy — disabled and loading together, as callers write it', () => {
    asAndroid();
    function Send({ busy }: { busy: boolean }): React.JSX.Element {
      return (
        <Button variant="solid" color="danger" disabled={busy} loading={busy} dataTestId="send">
          Enviar
        </Button>
      );
    }
    const { rerender } = render(<Send busy={false} />);
    const idle = screen.getByTestId('send');

    rerender(<Send busy />);
    expect(screen.getByTestId('send')).toBe(idle);
    rerender(<Send busy={false} />);

    expect(screen.getByTestId('send')).toBe(idle);
  });

  it('mounts once on the ready flip, then keeps that view through a busy press and its settle', () => {
    asAndroid();
    const { rerender } = render(<Confirm ready={false} />);
    const disabled = screen.getByTestId('confirm');

    rerender(<Confirm ready busy />);
    const ready = screen.getByTestId('confirm');
    rerender(<Confirm ready />);

    expect(ready).not.toBe(disabled);
    expect(screen.getByTestId('confirm')).toBe(ready);
  });

  it('keeps its view across a render that does not flip it', () => {
    asAndroid();
    const { rerender } = render(<Confirm ready />);
    const enabled = screen.getByTestId('confirm');

    rerender(<Confirm ready label="Confirmar cancelamento" />);

    expect(screen.getByTestId('confirm')).toBe(enabled);
  });
});
