import type { Monaco } from '@monaco-editor/react';
import Editor from '@monaco-editor/react';
import {
  alpha,
  Box,
  Paper,
  styled,
  Typography,
  useTheme,
} from '@mui/material';
import type { editor } from 'monaco-editor';
import type { FC} from 'react';
import React, { useEffect,useRef } from 'react';

import {
  buildEditorOptions,
  configureTypeScriptDefaults,
  COPIED_FEEDBACK_MS,
  registerEditorThemes,
  registerSaveShortcut,
  resolveEditorTheme,
  scheduleAutoFormat,
} from './CodeEditor.monaco';
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

// Prop defaults live here rather than in the component's own parameter list:
// every `= default` is another branch against the complexity gate, and nine of
// them left no budget for the render's own conditionals.
const resolveSettings = ({
  height = '400px',
  theme: themeProp = 'auto',
  readOnly = false,
  lineNumbers = true,
  minimap = false,
  fontSize = 14,
  wordWrap = false,
  showToolbar = true,
  autoFormat = false,
}: CodeEditorProps) => ({
  height,
  themeProp,
  readOnly,
  lineNumbers,
  minimap,
  fontSize,
  wordWrap,
  showToolbar,
  autoFormat,
});

// Editor handle, the three pieces of toolbar state, and the commands that act
// on them — everything the component holds that is not a render.
const useCodeEditorControls = ({
  autoFormat,
  readOnly,
  wordWrap,
  onSave,
}: {
  autoFormat: boolean;
  readOnly: boolean;
  wordWrap: boolean;
  onSave?: (value: string) => void;
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isWrapped, setIsWrapped] = React.useState(wordWrap);
  const [isCopied, setIsCopied] = React.useState(false);

  // Handle ESC key in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const handleEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleEsc);

    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  const onMount = (mountedEditor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;

    registerEditorThemes(monaco);
    configureTypeScriptDefaults(monaco);
    scheduleAutoFormat(mountedEditor, autoFormat && !readOnly);
    registerSaveShortcut(mountedEditor, monaco, onSave);
  };

  // Handle copy to clipboard
  // No-ops where the clipboard API is unavailable, as in jsdom.
  const onCopy = async () => {
    if (!editorRef.current || !navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(editorRef.current.getValue());
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Silently handle clipboard errors in test environments
    }
  };

  // Handle word wrap toggle
  const onWrapToggle = () => {
    setIsWrapped(!isWrapped);
    editorRef.current?.updateOptions({ wordWrap: !isWrapped ? 'on' : 'off' });
  };

  // Handle format document
  const onFormat = () => {
    if (editorRef.current && !readOnly) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  };

  return {
    isFullscreen,
    isWrapped,
    isCopied,
    onMount,
    onCopy,
    onFormat,
    onWrapToggle,
    onFullscreenToggle: () => setIsFullscreen(!isFullscreen),
  };
};

// The editing surface: the placeholder that shows through an empty document,
// and Monaco itself.
const CodeEditorSurface: FC<{
  language: string;
  value?: string;
  height: string | number;
  placeholder?: string;
  isFullscreen: boolean;
  editorTheme: string;
  editorOptions: editor.IStandaloneEditorConstructionOptions;
  dataTestId?: string;
  onChange?: (value: string) => void;
  onMount: (mountedEditor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
}> = ({
  language,
  value,
  height,
  placeholder,
  isFullscreen,
  editorTheme,
  editorOptions,
  dataTestId,
  onChange,
  onMount,
}) => (
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
      onMount={onMount}
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
);

export const CodeEditor: FC<CodeEditorProps> = (props) => {
  const { language, value, onChange, placeholder, onSave, dataTestId } = props;
  const { height, themeProp, readOnly, lineNumbers, minimap, fontSize, wordWrap, showToolbar, autoFormat } =
    resolveSettings(props);
  const theme = useTheme();
  const controls = useCodeEditorControls({ autoFormat, readOnly, wordWrap, onSave });

  // Determine theme
  const editorTheme = React.useMemo(
    () => resolveEditorTheme(themeProp, theme.palette.mode),
    [themeProp, theme.palette.mode],
  );

  const editorOptions = buildEditorOptions({
    minimap,
    fontSize,
    isWrapped: controls.isWrapped,
    lineNumbers,
    readOnly,
  });

  return (
    <EditorContainer elevation={2} data-testid={dataTestId || 'code-editor'}>
      {showToolbar && (
        <EditorToolbar
          language={language}
          readOnly={readOnly}
          isWrapped={controls.isWrapped}
          isCopied={controls.isCopied}
          isFullscreen={controls.isFullscreen}
          dataTestId={dataTestId}
          onFormat={controls.onFormat}
          onCopy={controls.onCopy}
          onWrapToggle={controls.onWrapToggle}
          onFullscreenToggle={controls.onFullscreenToggle}
        />
      )}

      <CodeEditorSurface
        language={language}
        value={value}
        height={height}
        placeholder={placeholder}
        isFullscreen={controls.isFullscreen}
        editorTheme={editorTheme}
        editorOptions={editorOptions}
        dataTestId={dataTestId}
        onChange={onChange}
        onMount={controls.onMount}
      />
    </EditorContainer>
  );
};

// Export default
export default CodeEditor;
