import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { SPACER_SIZE_UNITS, spacerDimensions } from './Spacer.metrics';
import { Spacer, toNativeDimension } from './Spacer.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. The NUMBERS are what is
 * asserted — the same spacing units `Spacer.tsx` hands to MUI's `theme.spacing`.
 */
describe('Spacer (native)', () => {
  it('renders an empty view under every spelling of the test id', () => {
    render(
      <>
        <Spacer testID="a" />
        <Spacer dataTestId="b" />
        <Spacer {...{ 'data-testid': 'c' }} />
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const spacer = screen.getByTestId(id);
      expect(spacer).toBeInTheDocument();
      expect(spacer).toBeEmptyDOMElement();
    }
  });

  it('is two spacing units on both axes by default, like the web md step', () => {
    render(<Spacer dataTestId="md" />);
    expect(screen.getByTestId('md')).toHaveStyle({ width: '16px', height: '16px' });
  });

  it('draws every step of the scale from the shared units', () => {
    const ui = createUiTheme();
    const expected = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const dims = spacerDimensions({ size }, ui.spacing);
      expect(dims.width, size).toBe(expected[size]);
      expect(dims.height, size).toBe(expected[size]);
      expect(ui.spacing(SPACER_SIZE_UNITS[size])).toBe(expected[size]);
    }
  });

  it('fills only the axis its direction names', () => {
    render(
      <>
        <Spacer dataTestId="h" direction="horizontal" size="lg" />
        <Spacer dataTestId="v" direction="vertical" size="lg" />
      </>,
    );
    const horizontal = screen.getByTestId('h');
    const vertical = screen.getByTestId('v');
    expect(horizontal).toHaveStyle({ width: '24px' });
    expect(horizontal.style.height).toBe('');
    expect(vertical).toHaveStyle({ height: '24px' });
    expect(vertical.style.width).toBe('');
  });

  it('lets an explicit dimension win on its axis, zero included', () => {
    render(
      <>
        <Spacer dataTestId="w" width={100} />
        <Spacer dataTestId="zero" width={0} height={0} />
        <Spacer dataTestId="cross" direction="vertical" width={40} />
      </>,
    );
    expect(screen.getByTestId('w')).toHaveStyle({ width: '100px', height: '16px' });
    expect(screen.getByTestId('zero')).toHaveStyle({ width: '0px', height: '0px' });
    // `direction="vertical"` leaves the width alone — and alone means the caller's.
    expect(screen.getByTestId('cross')).toHaveStyle({ width: '40px', height: '16px' });
  });

  it('reads CSS lengths against the 16px root the web uses, and passes percentages through', () => {
    expect(toNativeDimension('2rem')).toBe(32);
    expect(toNativeDimension('1.5em')).toBe(24);
    expect(toNativeDimension('20px')).toBe(20);
    expect(toNativeDimension('50%')).toBe('50%');
    expect(toNativeDimension('auto')).toBe('auto');
    expect(toNativeDimension(12)).toBe(12);
    // Not a length React Native has: yields to the step, as an unset dimension does.
    expect(toNativeDimension('calc(100% - 8px)')).toBeUndefined();
    expect(toNativeDimension(undefined)).toBeUndefined();
    render(<Spacer dataTestId="rem" width="2rem" height="calc(100% - 8px)" />);
    expect(screen.getByTestId('rem')).toHaveStyle({ width: '32px', height: '16px' });
  });

  it('grows to fill free space when flexed and never shrinks', () => {
    render(
      <>
        <Spacer dataTestId="flex" flex />
        <Spacer dataTestId="fixed" />
      </>,
    );
    expect(screen.getByTestId('flex')).toHaveStyle({ flexGrow: '1', flexShrink: '0', flexBasis: '0%' });
    const fixed = screen.getByTestId('fixed');
    expect(fixed).toHaveStyle({ flexShrink: '0' });
    expect(fixed.style.flexGrow).toBe('');
  });

  it('is decoration: hidden from assistive technology, deaf to touches, not focusable', () => {
    render(<Spacer dataTestId="deco" />);
    const spacer = screen.getByTestId('deco');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).not.toHaveAttribute('tabindex');
    expect(spacer).not.toHaveAttribute('role');
    expect(spacer).toHaveStyle({ pointerEvents: 'none' });
  });

  it('lets a caller style win over the resolved dimensions', () => {
    render(<Spacer dataTestId="s" style={{ width: 1 }} />);
    expect(screen.getByTestId('s')).toHaveStyle({ width: '1px', height: '16px' });
  });

  it('reads a host spacing unit from the provider', () => {
    render(
      <UiProvider theme={{ spacingUnit: 4 }}>
        <Spacer dataTestId="u" />
      </UiProvider>,
    );
    expect(screen.getByTestId('u')).toHaveStyle({ width: '8px', height: '8px' });
  });

  it('takes only the lengths a 16px root can resolve, and yields the rest to the size step', () => {
    expect(toNativeDimension(24)).toBe(24);
    expect(toNativeDimension('auto')).toBe('auto');
    expect(toNativeDimension('50%')).toBe('50%');
    expect(toNativeDimension('20px')).toBe(20);
    expect(toNativeDimension('1.5rem')).toBe(24);
    expect(toNativeDimension('2em')).toBe(32);
    // `parseFloat` would read each of these as a bare number; React Native has
    // no viewport, character or point unit, so they fall back like an unset one.
    for (const viewportUnit of ['50vw', '10vh', '4ch', '12pt', 'calc(100% - 8px)', 'inherit']) {
      expect(toNativeDimension(viewportUnit)).toBeUndefined();
    }
  });
});
