import CssBaseline from '@mui/material/CssBaseline/index.js';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Preview } from '@storybook/react-vite';
import * as monaco from 'monaco-editor';
// `?worker` is a Vite-only import suffix: builder-vite (this Storybook's
// builder) resolves it to a worker constructor. This file is not part of the
// package's `tsc`/tsup program (tsconfig.json's `include` is `src` only), so
// no other build reads these imports.
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import React from 'react';

import { configureCodeEditor } from '../src/components/form/CodeEditor/CodeEditor.monaco';

// The Monaco that runs here is the `monaco-editor` this package depends on
// (resolved from node_modules by Vite, this Storybook's builder), not the
// CDN build `@monaco-editor/react`'s default loader would otherwise fetch at
// runtime. See `CodeEditor.md` for why this setup can't live in the package
// itself, and the same snippet for a host app's own Vite entry point.
configureCodeEditor({
  monaco,
  getWorker: (_workerId, label) => {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
});

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