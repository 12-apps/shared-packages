import { createTheme, CssBaseline,ThemeProvider } from '@mui/material';
import type { Preview } from '@storybook/react-vite';
import React from 'react';

const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#6366F1',
    },
    secondary: {
      main: '#8B5CF6',
    },
  },
});

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#818CF8',
    },
    secondary: {
      main: '#A78BFA',
    },
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
        order: ['Navigation', '*'],
        locales: 'en-US',
      },
    },
    // Our breakpoints, not a device catalogue. The stock list is ~40 named
    // handsets that all fall between two of these widths, and it stops at
    // 1024 — narrower than the screens where wide-layout bugs live. These are
    // the widths the layout code actually branches on.
    viewport: {
      options: {
        xxs: { name: 'xxs (320)', type: 'mobile', styles: { width: '320px', height: '568px' } },
        xs: { name: 'xs (400)', type: 'mobile', styles: { width: '400px', height: '720px' } },
        sm: { name: 'sm (600)', type: 'mobile', styles: { width: '600px', height: '900px' } },
        md: { name: 'md (900)', type: 'tablet', styles: { width: '900px', height: '1000px' } },
        lg: { name: 'lg (1200)', type: 'desktop', styles: { width: '1200px', height: '900px' } },
        xlg: { name: 'xlg (1536)', type: 'desktop', styles: { width: '1536px', height: '960px' } },
        xxl: { name: 'xxl (2560)', type: 'desktop', styles: { width: '2560px', height: '1440px' } },
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'dark' ? darkTheme : lightTheme;
      return (
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Story />
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