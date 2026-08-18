import type { Preview } from '@storybook/react-vite';
import React from 'react';

/**
 * These screens render through `@12-apps/ui`, which brings its own theme, so
 * the only thing a story needs from the page around it is width — a login form
 * stretched to a 2560px viewport tells you nothing about how it looks in a
 * phone-sized column, which is where nearly all of this is read.
 */
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
        order: ['SignIn', 'SignUp', 'ForgotPassword', 'ResetPassword', 'VerifyEmail', 'SecurityCard', '*'],
        locales: 'en-US',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
