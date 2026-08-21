import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import type { Preview } from '@storybook/react-vite';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The discounts screens render through `@12-apps/ui`, which is MUI underneath,
 * so the only thing a story needs from the page around it is a theme. Same
 * palette as the UI library's own book, so a component looks here exactly as it
 * looks there.
 *
 * The router is the second thing, and it is NOT optional: the screen reads its
 * query from `useSearchParams` and writes it back through `useNavigate`, so a
 * story without a router throws before it renders. `MemoryRouter` gives each
 * story its own URL — which is also what lets a story SHOW a filtered list by
 * naming the params it starts at.
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
        // The whole screen first: the parts read better once the page they
        // sit in has been seen.
        order: ['Discounts/Screen', '*'],
        locales: 'en-US',
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === 'dark' ? darkTheme : lightTheme;
      const url = (context.parameters.initialUrl as string | undefined) ?? '/discounts';
      return (
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <MemoryRouter initialEntries={[url]}>
            {/* Wide, because the subject is an eight-column admin grid: squeeze
                it and the horizontal scroll becomes the first thing a reviewer
                sees instead of the layout. */}
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: 16 }}>
              <Story />
            </div>
          </MemoryRouter>
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
