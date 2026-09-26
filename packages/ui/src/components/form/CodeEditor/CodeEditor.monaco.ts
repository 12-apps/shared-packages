import type { Theme } from '@mui/material/styles/index.js';
import { loader, type Monaco } from '@monaco-editor/react';
import type { editor, Environment } from 'monaco-editor';

import { uiInk, type UiInk } from '../../../tokens/ink';

type EditorChrome = UiInk['codeEditor']['light'];

export interface ConfigureCodeEditorOptions {
  /**
   * The `monaco-editor` module the host's own bundler resolved, e.g.
   * `import * as monaco from 'monaco-editor'`. Handing it to the loader is
   * what stops `@monaco-editor/react` fetching its own copy from
   * `cdn.jsdelivr.net` at runtime — see `loader.config` below.
   */
  monaco: Monaco;
  /**
   * Monaco's web-worker factory. The package cannot supply this itself: wiring
   * a worker needs a bundler-specific import (Vite's `?worker` suffix, or the
   * equivalent in another bundler), and this package is built by tsup/esbuild,
   * which does not understand that suffix. The host's own Vite (or other)
   * entry point builds this from its own worker imports and passes it here.
   */
  getWorker: NonNullable<Environment['getWorker']>;
}

/**
 * Points `@monaco-editor/react` at the host's own installed Monaco instead of
 * its default CDN loader, and wires up Monaco's web workers.
 *
 * Bundler-agnostic on purpose: it takes the resolved `monaco` module and a
 * `getWorker` factory rather than importing either itself, so it can be
 * called from any Vite (or other bundler) entry point — see `CodeEditor.md`
 * for the Storybook preview and host snippets that call it.
 *
 * Call this once, before the first `CodeEditor` mounts (a Vite entry point's
 * module scope runs once, which is early enough).
 */
export const configureCodeEditor = ({ monaco, getWorker }: ConfigureCodeEditorOptions): void => {
  loader.config({ monaco });
  (self as unknown as { MonacoEnvironment: Environment }).MonacoEnvironment = { getWorker };
};

/** Monaco's colour keys, filled from one mode's chrome. */
const chromeColors = (chrome: EditorChrome) => ({
  'editor.background': chrome.background,
  'editor.foreground': chrome.foreground,
  'editor.lineHighlightBackground': chrome.lineHighlight,
  'editorLineNumber.foreground': chrome.lineNumber,
  'editorIndentGuide.background': chrome.gutterBorder,
  'editor.selectionBackground': chrome.selection,
});

const customLightTheme = (chrome: EditorChrome) => ({
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'D73A49' },
    { token: 'string', foreground: '032F62' },
    { token: 'number', foreground: '005CC5' },
  ],
  colors: chromeColors(chrome),
});

const customDarkTheme = (chrome: EditorChrome) => ({
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'F97583' },
    { token: 'string', foreground: '9ECBFF' },
    { token: 'number', foreground: '79B8FF' },
  ],
  colors: chromeColors(chrome),
});

// Main component
const AUTO_FORMAT_DELAY_MS = 100;

export const registerEditorThemes = (monaco: Monaco, theme: Theme) => {
  const chrome = uiInk(theme).codeEditor;
  monaco.editor.defineTheme('custom-light', customLightTheme(chrome.light));
  monaco.editor.defineTheme('custom-dark', customDarkTheme(chrome.dark));
};

// Best-effort: a Monaco build without the TypeScript worker (as in jsdom) throws
// here, and the editor is still usable without it.
export const configureTypeScriptDefaults = (monaco: Monaco) => {
  try {
    const tsLanguage = monaco.languages
      .getLanguages()
      .find((language) => language.id === 'typescript');

    if (!tsLanguage) return;

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types'],
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: true,
    });
  } catch {
    // Silently handle any TypeScript configuration errors in test environments
  }
};

export const scheduleAutoFormat = (mountedEditor: editor.IStandaloneCodeEditor, enabled: boolean) => {
  if (!enabled) return;

  window.setTimeout(() => {
    mountedEditor.getAction('editor.action.formatDocument')?.run();
  }, AUTO_FORMAT_DELAY_MS);
};

export const registerSaveShortcut = (
  mountedEditor: editor.IStandaloneCodeEditor,
  monaco: Monaco,
  onSave?: (value: string) => void,
) => {
  mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    onSave?.(mountedEditor.getValue());
  });
};

// 'auto' follows the MUI palette; otherwise the caller's choice wins.
export const resolveEditorTheme = (themeProp: string, paletteMode: string) => {
  const wantsDark = themeProp === 'auto' ? paletteMode === 'dark' : themeProp === 'dark';

  return wantsDark ? 'custom-dark' : 'custom-light';
};

// Monaco's options object. Only the first five entries vary with our props; the
// rest are fixed editor preferences.
