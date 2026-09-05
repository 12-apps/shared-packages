import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { View } from 'react-native';
import { describe, expect, it } from 'vitest';

import { renderTextChildren } from './text-children';

const style = { fontSize: 16 } as const;

/** A host that renders its children the way `Alert` and `Button` do. */
function Host({ children, lines }: { children?: React.ReactNode; lines?: number }): React.JSX.Element {
  return <View testID="host">{renderTextChildren(children, style, lines)}</View>;
}

/**
 * The rule this file pins: consecutive text children FLOW as one sentence,
 * and an element child breaks the run. The harness caught the opposite — an
 * alert body reading "O corpo do alerta na variante / success / ." down three
 * lines — which is what a per-child wrapper does.
 */
describe('renderTextChildren', () => {
  it('flows a run of text and number children as one line', () => {
    const total = 3;
    render(<Host>O total é {total}.</Host>);
    const host = screen.getByTestId('host');
    expect(host.childElementCount).toBe(1);
    expect(host.textContent).toBe('O total é 3.');
  });

  it('breaks the run around an element child, as a block would on the web', () => {
    render(
      <Host>
        antes
        <View testID="block" />
        depois
      </Host>,
    );
    const host = screen.getByTestId('host');
    expect(host.childElementCount).toBe(3);
    expect(host.firstElementChild).toHaveTextContent('antes');
    expect(host.lastElementChild).toHaveTextContent('depois');
    expect(screen.getByTestId('block')).toBeInTheDocument();
  });

  it('flattens a fragment, which React.Children.toArray does not look inside', () => {
    const total = 3;
    render(
      <Host>
        <>O total é {total}.</>
      </Host>,
    );
    const host = screen.getByTestId('host');
    expect(host.childElementCount).toBe(1);
    expect(host.textContent).toBe('O total é 3.');
  });

  it('renders nothing for no children', () => {
    render(<Host />);
    expect(screen.getByTestId('host').childElementCount).toBe(0);
  });

  it('clips to one line when asked, for a button label', () => {
    render(<Host lines={1}>Salvar alterações</Host>);
    // react-native-web renders numberOfLines as a line clamp.
    expect(screen.getByTestId('host').firstElementChild).toHaveTextContent('Salvar alterações');
  });
});
