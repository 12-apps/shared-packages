import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Box } from './Box.native';
import { resolveBoxLayout } from './box-layout';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

const theme = createUiTheme();

describe('Box (native)', () => {
  it('turns spacing units into px on the theme scale', () => {
    expect(resolveBoxLayout({ p: 2 }, theme)).toEqual({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
    expect(resolveBoxLayout({ px: 1, pt: 0.5, m: 3, mb: 0 }, theme)).toEqual({
      paddingTop: 4,
      paddingRight: 8,
      paddingLeft: 8,
      marginTop: 24,
      marginRight: 24,
      marginBottom: 0,
      marginLeft: 24,
    });
  });

  it('becomes a flex container only when a layout prop asks', () => {
    expect(resolveBoxLayout({}, theme)).toEqual({});
    expect(resolveBoxLayout({ gap: 1 }, theme)).toEqual({ display: 'flex', flexDirection: 'column', gap: 8 });
    expect(resolveBoxLayout({ direction: 'row', align: 'center', justify: 'between', wrap: true }, theme)).toEqual({
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    });
  });

  it('paints surfaces, palette slots, radii and a divider border', () => {
    expect(resolveBoxLayout({ bg: 'paper', radius: 'lg', bordered: true }, theme)).toEqual({
      backgroundColor: theme.palette.background.paper,
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: theme.palette.divider,
    });
    expect(resolveBoxLayout({ bg: 'primary' }, theme).backgroundColor).toBe(theme.palette.primary.main);
    expect(resolveBoxLayout({ bg: 'transparent' }, theme).backgroundColor).toBe('transparent');
  });

  it('renders a View with the resolved style and the test id', () => {
    render(
      <Box dataTestId="card" p={1} bg="primary" width="50%">
        <Box testID="inner" />
      </Box>,
    );
    const card = screen.getByTestId('card');
    expect(card).toHaveStyle({ paddingTop: '8px', backgroundColor: 'rgb(99, 102, 241)', width: '50%' });
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });

  it('lets a caller style win over the resolved layout', () => {
    render(<Box dataTestId="s" p={1} style={{ paddingTop: 1 }} />);
    expect(screen.getByTestId('s')).toHaveStyle({ paddingTop: '1px', paddingLeft: '8px' });
  });

  it('reads a host spacing unit from the provider', () => {
    render(
      <UiProvider theme={{ spacingUnit: 4 }}>
        <Box dataTestId="u" p={2} />
      </UiProvider>,
    );
    expect(screen.getByTestId('u')).toHaveStyle({ paddingTop: '8px' });
  });
});
