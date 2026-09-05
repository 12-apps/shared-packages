import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { containerPaddingUnits, resolveContainerMaxWidth } from './Container.metrics';
import { Container, containerStyle } from './Container.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';
import { Text } from '../../typography/Text/Text.native';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — MUI's breakpoints and the spacing units `Container.tsx` hands to
 * `theme.spacing` — not a snapshot.
 *
 * jsdom lays nothing out, so `useWindowDimensions()` reports a 0×0 window
 * here: a `responsive` container is always in its compact state in these
 * tests, exactly as it would be on a phone. The wide cases go through
 * `containerStyle` with an explicit window.
 */
const desktop = { width: 1280, height: 720 };
const phone = { width: 375, height: 667 };

describe('Container (native)', () => {
  it('renders its children under the default test id, or any spelling of a given one', () => {
    render(
      <>
        <Container>
          <Text>conteúdo</Text>
        </Container>
        <Container testID="a">
          <Text>a</Text>
        </Container>
        <Container dataTestId="b">
          <Text>b</Text>
        </Container>
        <Container {...{ 'data-testid': 'c' }}>
          <Text>c</Text>
        </Container>
      </>,
    );
    expect(screen.getByTestId('container')).toHaveTextContent('conteúdo');
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toHaveTextContent(id);
  });

  it('is a full-width column between auto margins, limited to lg by default', () => {
    const ui = createUiTheme();
    const style = containerStyle(ui, base({}));
    expect(style.width).toBe('100%');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');
    expect(style.maxWidth).toBe(1200);
  });

  it('limits the column at MUI breakpoints, drops the limit for false, and reads a stranger as lg', () => {
    const ui = createUiTheme();
    const widths = { xs: 444, sm: 600, md: 900, lg: 1200, xl: 1536 } as const;
    for (const key of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      expect(containerStyle(ui, base({ maxWidth: key })).maxWidth, key).toBe(widths[key]);
    }
    expect(containerStyle(ui, base({ maxWidth: false })).maxWidth).toBeUndefined();
    expect(containerStyle(ui, base({ maxWidth: '80ch' })).maxWidth).toBe(1200);
    expect(resolveContainerMaxWidth('default', 'sm')).toBe('sm');
  });

  it('fluid has no limit; centered is md wide and centres its content over the window height', () => {
    const ui = createUiTheme();
    expect(containerStyle(ui, base({ variant: 'fluid', maxWidth: 'xs' })).maxWidth).toBeUndefined();
    const centered = containerStyle(ui, base({ variant: 'centered', maxWidth: 'xl' }));
    expect(centered.maxWidth).toBe(900);
    expect(centered.alignItems).toBe('center');
    expect(centered.justifyContent).toBe('center');
    expect(centered.minHeight).toBe(720);
    expect(containerStyle(ui, base({})).alignItems).toBeUndefined();
  });

  it('insets on the spacing scale, with none and a stranger painting the default as the web does', () => {
    const ui = createUiTheme();
    const expected = { xs: 8, sm: 16, md: 24, lg: 32, xl: 48 } as const;
    for (const padding of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      expect(containerStyle(ui, base({ padding })).padding, padding).toBe(expected[padding]);
    }
    // The web reads its map with `||`, so `none`'s 0 falls through to `md` — see NATIVE-NOTES.md.
    expect(containerStyle(ui, base({ padding: 'none' })).padding).toBe(24);
    expect(containerPaddingUnits('huge', false)).toBe(3);
  });

  it('paints padded with the same insets as default, as the web does', () => {
    const ui = createUiTheme();
    // The web declares 64px above and below BEFORE its `padding` shorthand,
    // which overrides them — see NATIVE-NOTES.md.
    expect(containerStyle(ui, base({ variant: 'padded' }))).toEqual(containerStyle(ui, base({})));
  });

  it('tightens to two units under 600px only while responsive', () => {
    const ui = createUiTheme();
    expect(containerStyle(ui, base({ window: phone })).padding).toBe(16);
    expect(containerStyle(ui, base({ window: { width: 599, height: 900 } })).padding).toBe(16);
    expect(containerStyle(ui, base({ window: { width: 600, height: 900 } })).padding).toBe(24);
    expect(containerStyle(ui, base({ window: phone, responsive: false, padding: 'lg' })).padding).toBe(32);
  });

  it('renders a View with the resolved numbers, compact in jsdom’s 0-wide window', () => {
    render(
      <>
        <Container dataTestId="wide" responsive={false} padding="lg" maxWidth="sm">
          <Text>x</Text>
        </Container>
        <Container dataTestId="narrow" padding="lg">
          <Text>x</Text>
        </Container>
      </>,
    );
    expect(screen.getByTestId('wide')).toHaveStyle({
      width: '100%',
      maxWidth: '600px',
      paddingTop: '32px',
      paddingLeft: '32px',
      marginLeft: 'auto',
      marginRight: 'auto',
    });
    expect(screen.getByTestId('narrow')).toHaveStyle({ paddingTop: '16px', paddingRight: '16px' });
  });

  it('lets a caller style win over the resolved layout', () => {
    render(
      <Container dataTestId="s" responsive={false} style={{ maxWidth: 320, paddingTop: 1 }}>
        <Text>x</Text>
      </Container>,
    );
    expect(screen.getByTestId('s')).toHaveStyle({ maxWidth: '320px', paddingTop: '1px', paddingLeft: '24px' });
  });

  it('reads a host spacing unit from the provider', () => {
    render(
      <UiProvider theme={{ spacingUnit: 4 }}>
        <Container dataTestId="u" responsive={false}>
          <Text>x</Text>
        </Container>
      </UiProvider>,
    );
    expect(screen.getByTestId('u')).toHaveStyle({ paddingTop: '12px' });
  });
});

function base(over: Partial<Parameters<typeof containerStyle>[1]>): Parameters<typeof containerStyle>[1] {
  return { variant: 'default', maxWidth: 'lg', padding: 'md', responsive: true, window: desktop, ...over };
}
