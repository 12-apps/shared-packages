import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Box, layoutToSx } from './Box';

/**
 * THE WEB HALF OF THE ALIGNMENT GUARANTEE.
 *
 * `resolveBoxLayout` hands back px numbers; the native `Box` puts them in a
 * `style` and is done. `sx` would read the same numbers as spacing units and
 * radius multiples, so the web `Box` must write them as px strings first —
 * these tests read what emotion actually painted.
 */
describe('Box (web)', () => {
  it('writes the resolved numbers as px, not as sx units', () => {
    expect(layoutToSx({ paddingTop: 16, gap: 8, borderRadius: 8, width: 1, flex: 1, display: 'flex' })).toEqual({
      paddingTop: '16px',
      gap: '8px',
      borderRadius: '8px',
      width: '1px',
      flex: 1,
      display: 'flex',
    });
  });

  it('paints p={2} as 16px on every side, like the native Box', () => {
    render(<Box p={2} px={3} mt={1} dataTestId="scale" />);
    expect(screen.getByTestId('scale')).toHaveStyle({
      paddingTop: '16px',
      paddingBottom: '16px',
      paddingLeft: '24px',
      paddingRight: '24px',
      marginTop: '8px',
    });
  });

  it('becomes a flex container with the gap in px', () => {
    render(<Box direction="row" gap={1} align="center" justify="between" dataTestId="flex" />);
    expect(screen.getByTestId('flex')).toHaveStyle({
      display: 'flex',
      flexDirection: 'row',
      gap: '8px',
      alignItems: 'center',
      justifyContent: 'space-between',
    });
  });

  it('paints a surface, a radius and a divider border from the MUI theme', () => {
    render(<Box bg="primary" radius="lg" bordered dataTestId="surface" />);
    const theme = createTheme();
    expect(screen.getByTestId('surface')).toHaveStyle({
      backgroundColor: theme.palette.primary.main,
      borderRadius: '8px',
      borderWidth: '1px',
      borderColor: theme.palette.divider,
    });
  });

  it('reads the host theme: spacing unit and radius', () => {
    render(
      <ThemeProvider theme={createTheme({ spacing: 4, shape: { borderRadius: 12 } })}>
        <Box p={2} radius="md" dataTestId="host" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('host')).toHaveStyle({ paddingTop: '8px', borderRadius: '12px' });
  });

  it('lets the caller sx win over the resolved layout', () => {
    render(<Box p={2} sx={{ paddingTop: '1px' }} dataTestId="sx" />);
    expect(screen.getByTestId('sx')).toHaveStyle({ paddingTop: '1px', paddingLeft: '16px' });
  });

  it('honours every spelling of the test id and leaves none on the DOM', () => {
    render(
      <>
        <Box testID="a" />
        <Box dataTestId="b" />
        <Box {...{ 'data-testid': 'c' }} />
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });
});
