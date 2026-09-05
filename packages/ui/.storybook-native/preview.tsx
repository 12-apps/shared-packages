import type { Preview } from '@storybook/react-native-web-vite';
import React from 'react';

import { UiProvider } from '../src/provider/UiProvider.native';
import { createUiTheme } from '../src/tokens/theme';

/**
 * The native preview mounts the native `UiProvider` — no MUI theme, no
 * CssBaseline, no emotion — with the same brand seeds the web preview passes
 * to `createTheme`. The web preview's `#6366F1`/`#8B5CF6` pair IS
 * `DEFAULT_BRAND.light`, so a story renders the same colours on both sides.
 */
const light = createUiTheme({ mode: 'light' });
const dark = createUiTheme({ mode: 'dark' });

const preview: Preview = {
  parameters: {
    // No `argTypesRegex`: the native Button also answers `onPress`, and an
    // implicit action arg on it makes every shared `play` that clicks fail with
    // "implicit action arg while playing". The stories that need a spy pass
    // `fn()` explicitly, which is what Storybook 8+ asks for anyway.
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },
    options: { storySort: { method: 'alphabetical', order: ['Navigation', '*'], locales: 'en-US' } },
  },
  decorators: [
    (Story, context) => (
      <UiProvider theme={context.globals.theme === 'dark' ? dark : light}>
        <Story />
      </UiProvider>
    ),
  ],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Global theme for components',
      defaultValue: 'light',
      toolbar: { icon: 'circlehollow', items: ['light', 'dark'] },
    },
  },
};

export default preview;
