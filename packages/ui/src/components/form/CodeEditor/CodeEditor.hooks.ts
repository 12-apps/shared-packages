import type { Monaco } from '@monaco-editor/react';
import { useTheme } from '@mui/material';
import type { editor } from 'monaco-editor';
import React, { useEffect, useRef } from 'react';

import {
  configureTypeScriptDefaults,
  registerEditorThemes,
  registerSaveShortcut,
  resolveEditorTheme,
  scheduleAutoFormat,
} from './CodeEditor.monaco';

const COPIED_FEEDBACK_MS = 2000;

// Escape leaves fullscreen, so the flag and its listener belong together.
const useFullscreen = () => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  useEffect(() => {
    if (!isFullscreen) return;

    const handleEsc = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen]);

  return { isFullscreen, toggleFullscreen: () => setIsFullscreen((prev) => !prev) };
};

// All of the editor's own state: the Monaco handles, the three toggles, and the
// handlers that drive them.
export const useCodeEditor = ({
  themeProp,
  wordWrap,
  autoFormat,
  readOnly,
  onSave,
}: {
  themeProp: string;
  wordWrap: boolean;
  autoFormat: boolean;
  readOnly: boolean;
  onSave?: (value: string) => void;
}) => {
  const theme = useTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const [isWrapped, setIsWrapped] = React.useState(wordWrap);
  const [isCopied, setIsCopied] = React.useState(false);

  const editorTheme = React.useMemo(
    () => resolveEditorTheme(themeProp, theme.palette.mode),
    [themeProp, theme.palette.mode],
  );

  const handleEditorDidMount = (mountedEditor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = mountedEditor;
    monacoRef.current = monaco;

    registerEditorThemes(monaco);
    configureTypeScriptDefaults(monaco);
    scheduleAutoFormat(mountedEditor, autoFormat && !readOnly);
    registerSaveShortcut(mountedEditor, monaco, onSave);
  };

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

  const handleWrapToggle = () => {
    setIsWrapped(!isWrapped);
    editorRef.current?.updateOptions({ wordWrap: !isWrapped ? 'on' : 'off' });
  };

  const handleFormat = () => {
    if (!readOnly) editorRef.current?.getAction('editor.action.formatDocument')?.run();
  };

  return {
    editorTheme,
    isFullscreen,
    isWrapped,
    isCopied,
    handleEditorDidMount,
    handleCopy,
    handleFullscreenToggle: toggleFullscreen,
    handleWrapToggle,
    handleFormat,
  };
};
