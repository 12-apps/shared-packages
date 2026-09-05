import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';
import { ICON_PATHS } from './paths.generated';

describe('Icon (web)', () => {
  it('draws the generated path through SvgIcon at the md size', () => {
    render(<Icon name="Close" />);
    const svg = screen.getByTestId('icon-Close');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.Close[0]);
    expect(svg).toHaveStyle({ fontSize: '24px' });
  });

  it('sizes from the scale or an exact number', () => {
    render(
      <>
        <Icon name="Check" size="xs" testID="xs" />
        <Icon name="Check" size={30} testID="n" />
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ fontSize: '16px' });
    expect(screen.getByTestId('n')).toHaveStyle({ fontSize: '30px' });
  });

  it('fills from the palette, the surrounding text, or a literal', () => {
    render(
      <div style={{ color: 'rgb(1, 2, 3)' }}>
        <Icon name="Info" color="danger" testID="d" />
        <Icon name="Info" testID="t" />
        <Icon name="Info" color="#123456" testID="l" />
      </div>,
    );
    expect(screen.getByTestId('d')).toHaveStyle({ color: '#d32f2f' });
    // `currentColor`: the parent's ink, which is what native cannot inherit and reads from the theme instead.
    expect(screen.getByTestId('t')).toHaveStyle({ color: 'rgb(1, 2, 3)' });
    expect(screen.getByTestId('l')).toHaveStyle({ color: '#123456' });
  });

  it('is decorative without a label and titled with one', () => {
    render(
      <>
        <Icon name="Warning" testID="deco" />
        <Icon name="Warning" label="Atenção" testID="named" />
      </>,
    );
    expect(screen.getByTestId('deco')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('named').querySelector('title')).toHaveTextContent('Atenção');
    expect(screen.getByTestId('named')).not.toHaveAttribute('aria-hidden');
  });
});
