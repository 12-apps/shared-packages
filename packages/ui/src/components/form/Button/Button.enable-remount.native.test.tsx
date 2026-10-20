import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button.native';

/**
 * A native Button is a NEW view when it turns enabled or disabled (FUT-3775).
 * On Android, a disabled solid Button that turned enabled painted its new
 * fill and no label — the courier app's cancel, join and finish sheets showed
 * a red block with no text. A Button that mounts enabled draws its label, so
 * the flip mounts it again. Measured on the Maestro emulator lane: the label
 * key alone did not bring the label back; this did.
 */
function Confirm({ ready, label = 'Confirmar' }: { ready: boolean; label?: string }): React.JSX.Element {
  return (
    <Button variant="solid" color="danger" disabled={!ready} dataTestId="confirm">
      {label}
    </Button>
  );
}

describe('Button (native) — the enable flip', () => {
  it('mounts a new view when the button turns enabled', () => {
    const { rerender } = render(<Confirm ready={false} />);
    const disabled = screen.getByTestId('confirm');

    rerender(<Confirm ready />);

    expect(screen.getByTestId('confirm')).not.toBe(disabled);
    expect(screen.getByTestId('confirm')).toHaveTextContent('Confirmar');
  });

  it('keeps its view across a render that does not flip it', () => {
    const { rerender } = render(<Confirm ready />);
    const enabled = screen.getByTestId('confirm');

    rerender(<Confirm ready label="Confirmar cancelamento" />);

    expect(screen.getByTestId('confirm')).toBe(enabled);
  });

  it('mounts a new view when a loading button settles, as loading is inactive too', () => {
    function Busy({ busy }: { busy: boolean }): React.JSX.Element {
      return (
        <Button variant="solid" color="danger" loading={busy} dataTestId="busy">
          Enviar
        </Button>
      );
    }
    const { rerender } = render(<Busy busy />);
    const loading = screen.getByTestId('busy');

    rerender(<Busy busy={false} />);

    expect(screen.getByTestId('busy')).not.toBe(loading);
  });
});
