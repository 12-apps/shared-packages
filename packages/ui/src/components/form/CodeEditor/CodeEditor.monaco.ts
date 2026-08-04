import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

const customLightTheme = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'D73A49' },
    { token: 'string', foreground: '032F62' },
    { token: 'number', foreground: '005CC5' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#24292E',
    'editor.lineHighlightBackground': '#F6F8FA',
    'editorLineNumber.foreground': '#959DA5',
    'editorIndentGuide.background': '#D1D5DA',
    'editor.selectionBackground': '#C8E1FF',
  },
};

const customDarkTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'F97583' },
    { token: 'string', foreground: '9ECBFF' },
    { token: 'number', foreground: '79B8FF' },
  ],
  colors: {
    'editor.background': '#0D1117',
    'editor.foreground': '#C9D1D9',
    'editor.lineHighlightBackground': '#161B22',
    'editorLineNumber.foreground': '#8B949E',
    'editorIndentGuide.background': '#21262D',
    'editor.selectionBackground': '#3392FF44',
  },
};

// Main component
const AUTO_FORMAT_DELAY_MS = 100;
const COPIED_FEEDBACK_MS = 2000;

export const registerEditorThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme('custom-light', customLightTheme);
  monaco.editor.defineTheme('custom-dark', customDarkTheme);
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
