import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import type { Preview } from '@storybook/react-vite';
import React from 'react';

/**
 * The lifecycle screens render through `@12-apps/ui`, which is MUI underneath,
 * so the only thing a story needs from the page around it is a theme. Same
 * palette as the UI library's own book, so a component looks here exactly as it
 * looks there.
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
        // The comparison panel is what this book was opened for.
        order: ['Version comparison', '*'],
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
          {/* Wider than the payments book's 720: this panel is a table that
              can carry four version columns, and squeezing it would make the
              horizontal scroll the first thing a reviewer sees. */}
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
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
