import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Container } from './Container';

/**
 * The web `Container` now derives its insets and its max-width rule from
 * `Container.metrics.ts`, which the native `Container` reads too. These pin the
 * emitted values to what the inline `getPadding`/`getMaxWidth` produced — the
 * two quirks included (see `NATIVE-NOTES.md`), because this refactor's job is
 * to change nothing a browser paints.
 */
describe('Container (web)', () => {
  it('is `container` by default and honours testID, dataTestId and data-testid', () => {
    render(
      <>
        <Container>x</Container>
        <Container testID="a">a</Container>
        <Container dataTestId="b">b</Container>
        <Container {...{ 'data-testid': 'c' }}>c</Container>
      </>,
    );
    expect(screen.getByTestId('container')).toBeInTheDocument();
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });

  it('insets from the spacing scale as MUI spacing strings', () => {
    render(
      <>
        <Container padding="xs" dataTestId="xs">x</Container>
        <Container dataTestId="md">x</Container>
        <Container padding="xl" dataTestId="xl">x</Container>
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ padding: '8px' });
    expect(screen.getByTestId('md')).toHaveStyle({ padding: '24px' });
    expect(screen.getByTestId('xl')).toHaveStyle({ padding: '48px' });
  });

  it('paints no inset for none, and padded above and below', () => {
    render(
      <>
        <Container padding="none" responsive={false} dataTestId="none">x</Container>
        <Container variant="padded" responsive={false} dataTestId="padded">x</Container>
      </>,
    );
    // `none` is 0 — the `??` that replaced a `||` reading 0 as falsy.
    expect(screen.getByTestId('none')).toHaveStyle({ padding: '0px' });
    // `padded` keeps the horizontal inset and paints 64px above and below,
    // declared AFTER the shorthand that used to override it.
    expect(screen.getByTestId('padded')).toHaveStyle({
      paddingTop: '64px',
      paddingBottom: '64px',
      paddingLeft: '24px',
      paddingRight: '24px',
    });
  });

  it('hands MUI the resolved breakpoint: fluid none, centered md, a stranger lg', () => {
    render(
      <>
        <Container variant="fluid" dataTestId="fluid">x</Container>
        <Container variant="centered" maxWidth="xl" dataTestId="centered">x</Container>
        <Container maxWidth="80ch" dataTestId="stranger">x</Container>
        <Container maxWidth="xs" dataTestId="xs">x</Container>
      </>,
    );
    expect(screen.getByTestId('fluid').className).not.toMatch(/MuiContainer-maxWidth/);
    expect(screen.getByTestId('centered').className).toMatch(/MuiContainer-maxWidthMd/);
    expect(screen.getByTestId('centered')).toHaveStyle({ display: 'flex', minHeight: '100vh' });
    expect(screen.getByTestId('stranger').className).toMatch(/MuiContainer-maxWidthLg/);
    expect(screen.getByTestId('xs').className).toMatch(/MuiContainer-maxWidthXs/);
  });
});
