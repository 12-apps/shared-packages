import type { Monaco } from '@monaco-editor/react';
import Editor from '@monaco-editor/react';
import CodeIcon from '@mui/icons-material/Code';
import CopyIcon from '@mui/icons-material/ContentCopy';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import ExitFullscreenIcon from '@mui/icons-material/FullscreenExit';
import WrapIcon from '@mui/icons-material/WrapText';
import {
  alpha,
  Box,
  IconButton,
  Paper,
  Stack,
  styled,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { editor } from 'monaco-editor';
import type { FC} from 'react';
import React, { useEffect,useRef } from 'react';

import { EditorToolbar } from './CodeEditorToolbar';
import type { CodeEditorProps } from './CodeEditor.types';

// Styled components
const EditorContainer = styled(Paper)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden',
}));

const EditorWrapper = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'fullscreen',
})<{ fullscreen: boolean }>(({ theme, fullscreen }) => ({
  position: 'relative',
  flex: 1,
  minHeight: 200,
  ...(fullscreen && {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: theme.zIndex.modal,
    background: theme.palette.background.paper,
  }),
}));

const PlaceholderOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(2),
  left: theme.spacing(8),
  color: theme.palette.text.disabled,
  fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
  fontSize: '0.875rem',
  pointerEvents: 'none',
  userSelect: 'none',
}));

// Monaco editor themes
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

const registerEditorThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme('custom-light', customLightTheme);
  monaco.editor.defineTheme('custom-dark', customDarkTheme);
};

// Best-effort: a Monaco build without the TypeScript worker (as in jsdom) throws
// here, and the editor is still usable without it.
const configureTypeScriptDefaults = (monaco: Monaco) => {
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

const scheduleAutoFormat = (mountedEditor: editor.IStandaloneCodeEditor, enabled: boolean) => {
  if (!enabled) return;

  window.setTimeout(() => {
    mountedEditor.getAction('editor.action.formatDocument')?.run();
  }, AUTO_FORMAT_DELAY_MS);
};

const registerSaveShortcut = (
  mountedEditor: editor.IStandaloneCodeEditor,
  monaco: Monaco,
  onSave?: (value: string) => void,
) => {
  mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    onSave?.(mountedEditor.getValue());
  });
};

// 'auto' follows the MUI palette; otherwise the caller's choice wins.
const resolveEditorTheme = (themeProp: string, paletteMode: string) => {
  const wantsDark = themeProp === 'auto' ? paletteMode === 'dark' : themeProp === 'dark';

  return wantsDark ? 'custom-dark' : 'custom-light';
};

// Monaco's options object. Only the first five entries vary with our props; the
// rest are fixed editor preferences.
const buildEditorOptions = ({
  minimap,
  fontSize,
  isWrapped,
  lineNumbers,
  readOnly,
}: {
  minimap?: boolean;
  fontSize: number;
  isWrapped: boolean;
  lineNumbers: boolean;
  readOnly: boolean;
}): editor.IStandaloneEditorConstructionOptions => ({
    readOnly,
    // Explicitly convert minimap to boolean to ensure Monaco receives a definitive value
    // This prevents undefined from being interpreted differently in various environments
    minimap: { enabled: minimap === true },
    fontSize,
    wordWrap: isWrapped ? 'on' : 'off',
    lineNumbers: lineNumbers ? 'on' : 'off',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    foldingStrategy: 'indentation',
    showFoldingControls: 'mouseover',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderWhitespace: 'selection',
    renderLineHighlight: 'all',
    selectOnLineNumbers: true,
    roundedSelection: true,
    padding: { top: 16, bottom: 16 },
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
    fontLigatures: true,
});

export const CodeEditor: FC<CodeEditorProps> = ({
  language,
  height = '400px',
  theme: themeProp = 'auto',
  value,
  onChange,
  readOnly = false,
  lineNumbers = true,
  minimap = false,
  fontSize = 14,
  wordWrap = false,
  showToolbar = true,
  autoFormat = false,
  placeholder,
  onSave,
  dataTestId,
}) => {
  const theme = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isWrapped, setIsWrapped] = React.useState(wordWrap);
  const [isCopied, setIsCopied] = React.useState(false);

  // Determine theme
  const editorTheme = React.useMemo(
    () => resolveEditorTheme(themeProp, theme.palette.mode),
    [themeProp, theme.palette.mode],
  );

  const handleEditorDidMount = (
    mountedEditor: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;

    registerEditorThemes(monaco);
    configureTypeScriptDefaults(monaco);
    scheduleAutoFormat(mountedEditor, autoFormat && !readOnly);
    registerSaveShortcut(mountedEditor, monaco, onSave);
  };

  // Handle copy to clipboard
  // No-ops where the clipboard API is unavailable, as in jsdom.
  const handleCopy = async () => {
    if (!editorRef.current || !navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(editorRef.current.getValue());
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Silently handle clipboard errors in test environments
    }
  };

  // Handle fullscreen toggle
  const handleFullscreenToggle = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Handle word wrap toggle
  const handleWrapToggle = () => {
    setIsWrapped(!isWrapped);
    if (editorRef.current) {
      editorRef.current.updateOptions({
        wordWrap: !isWrapped ? 'on' : 'off',
      });
    }
  };

  // Handle format document
  const handleFormat = () => {
    if (editorRef.current && !readOnly) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  };

  // Handle ESC key in fullscreen
  useEffect(() => {
    if (isFullscreen) {
      const handleEsc = (e: globalThis.KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsFullscreen(false);
        }
      };
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isFullscreen]);

  const editorOptions = buildEditorOptions({ minimap, fontSize, isWrapped, lineNumbers, readOnly });

  return (
    <EditorContainer elevation={2} data-testid={dataTestId || 'code-editor'}>
      {showToolbar && (
        <EditorToolbar
          language={language}
          readOnly={readOnly}
          isWrapped={isWrapped}
          isCopied={isCopied}
          isFullscreen={isFullscreen}
          dataTestId={dataTestId}
          onFormat={handleFormat}
          onCopy={handleCopy}
          onWrapToggle={handleWrapToggle}
          onFullscreenToggle={handleFullscreenToggle}
        />
      )}

      <EditorWrapper
        fullscreen={isFullscreen}
        data-testid={dataTestId ? `${dataTestId}-editor-wrapper` : 'code-editor-editor-wrapper'}
      >
        {placeholder && !value && (
          <PlaceholderOverlay
            data-testid={dataTestId ? `${dataTestId}-placeholder` : 'code-editor-placeholder'}
          >
            {placeholder}
          </PlaceholderOverlay>
        )}

        <Editor
          height={isFullscreen ? '100vh' : height}
          language={language}
          value={value}
          onChange={(newValue) => onChange?.(newValue || '')}
          theme={editorTheme}
          options={editorOptions}
          onMount={handleEditorDidMount}
          loading={
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'text.secondary',
              }}
            >
              <Typography variant="body2">Loading editor...</Typography>
            </Box>
          }
        />
      </EditorWrapper>
    </EditorContainer>
  );
};

// Export default
export default CodeEditor;
