import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';

import { UiProvider } from './UiProvider.native';
import { useUiTheme } from './use-ui-theme.native';
import { createUiTheme, DEFAULT_UI_THEME } from '../tokens/theme';

function Probe(): React.JSX.Element {
  const theme = useUiTheme();
  return <Text testID="probe">{`${theme.mode}:${theme.palette.primary.main}:${theme.spacing(1)}`}</Text>;
}

describe('UiProvider (native)', () => {
  it('falls back to the package default without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent(`light:${DEFAULT_UI_THEME.palette.primary.main}:8`);
  });

  it('accepts options and builds the theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark', spacingUnit: 4 }}>
        <Probe />
      </UiProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:#818CF8:4');
  });

  it('accepts a built theme as is', () => {
    const theme = createUiTheme({ palette: { primary: '#00897b' } });
    render(
      <UiProvider theme={theme}>
        <Probe />
      </UiProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('light:#00897b:8');
  });

  it('the nearest provider wins', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <UiProvider theme={{ mode: 'light' }}>
          <Probe />
        </UiProvider>
      </UiProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(/^light:/);
  });
});
