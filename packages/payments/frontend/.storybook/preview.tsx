import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import type { Preview } from '@storybook/react-vite';
import React from 'react';

/**
 * The checkout renders through the SLOT contract (`components/checkout/ui.tsx`)
 * and falls back to raw MUI. So the only thing a story needs from the page
 * around it is a theme — which is exactly the point: a host with no design
 * system gets these pixels, and the "foreign design system" story proves a host
 * with one gets its own.
 */
const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#6366F1' },
    secondary: { main: '#8B5CF6' },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#818CF8' },
    secondary: { main: '#A78BFA' },
  },
});

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    options: {
      storySort: {
        method: 'alphabetical',
        order: ['Checkout', '*'],
        locales: 'en-US',
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'dark' ? darkTheme : lightTheme;
      return (
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
            <Story />
          </div>
        </ThemeProvider>
      );
    },
  ],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: ['light', 'dark'],
        showName: true,
      },
    },
  },
};

export default preview;
