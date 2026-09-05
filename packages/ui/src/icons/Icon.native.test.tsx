import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon.native';
import { ICON_NAMES, ICON_PATHS } from './paths.generated';
import { UiProvider } from '../provider/UiProvider.native';

describe('Icon (native)', () => {
  it('draws the generated path for the glyph, at the md size', () => {
    render(<Icon name="Close" />);
    const svg = screen.getByTestId('icon-Close');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.Close[0]);
  });

  it('sizes from the scale or an exact number', () => {
    render(
      <>
        <Icon name="Check" size="xs" testID="xs" />
        <Icon name="Check" size={30} testID="n" />
      </>,
    );
    expect(screen.getByTestId('xs').getAttribute('width')).toBe('16');
    expect(screen.getByTestId('n').getAttribute('height')).toBe('30');
  });

  it('fills from the palette, the text colour, or a literal', () => {
    render(
      <UiProvider>
        <Icon name="Info" color="danger" testID="d" />
        <Icon name="Info" testID="t" />
        <Icon name="Info" color="#123456" testID="l" />
      </UiProvider>,
    );
    expect(screen.getByTestId('d').getAttribute('fill')).toBe('#d32f2f');
    expect(screen.getByTestId('t').getAttribute('fill')).toBe('rgba(0, 0, 0, 0.87)');
    expect(screen.getByTestId('l').getAttribute('fill')).toBe('#123456');
  });

  it('is decorative without a label and named with one', () => {
    render(
      <>
        <Icon name="Warning" testID="deco" />
        <Icon name="Warning" label="Atenção" testID="named" />
      </>,
    );
    expect(screen.getByTestId('deco')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('named')).toHaveAttribute('aria-label', 'Atenção');
  });

  it('ships every glyph the list names', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(30);
    for (const name of ICON_NAMES) expect(ICON_PATHS[name].length).toBeGreaterThan(0);
  });
});
