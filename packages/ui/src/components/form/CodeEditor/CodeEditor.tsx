import Editor from '@monaco-editor/react';
import {
  alpha,
  Box,
  Paper,
  styled,
  Typography } from '@mui/material';
import type { editor } from 'monaco-editor';
import type { FC} from 'react';
import React, {  } from 'react';

import { makeTestId, resolveCodeEditorProps } from './CodeEditor.helpers';
import { useCodeEditor } from './CodeEditor.hooks';
import type { CodeEditorProps } from './CodeEditor.types';
import { EditorToolbar } from './CodeEditorToolbar';

// Styled components
const EditorContainer = styled(Paper)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.98)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden' }));

const EditorWrapper = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'fullscreen' })<{ fullscreen: boolean }>(({ theme, fullscreen }) => ({
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
    background: theme.palette.background.paper }) }));

const PlaceholderOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(2),
  left: theme.spacing(8),
  color: theme.palette.text.disabled,
  fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
  fontSize: '0.875rem',
  pointerEvents: 'none',
  userSelect: 'none' }));

// Monaco editor themes
const EditorLoading: FC<{ label: string }> = ({ label }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'text.secondary' }}
  >
    <Typography variant="body2">{label}</Typography>
  </Box>
);

const buildEditorOptions = ({
  minimap,
  fontSize,
  isWrapped,
  lineNumbers,
  readOnly }: {
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
    fontLigatures: true });

export const CodeEditor: FC<CodeEditorProps> = (componentProps) => {
  const {
    language,
    height,
    theme: themeProp,
    value,
    onChange,
    readOnly,
    lineNumbers,
    minimap,
    fontSize,
    wordWrap,
    showToolbar,
    autoFormat,
    placeholder,
    onSave,
    dataTestId,
    copy } = resolveCodeEditorProps(componentProps);

  const testId = makeTestId(dataTestId);
  const editor = useCodeEditor({ themeProp, wordWrap, autoFormat, readOnly, onSave });

  const editorOptions = buildEditorOptions({
    minimap,
    fontSize,
    isWrapped: editor.isWrapped,
    lineNumbers,
    readOnly });

  return (
    <EditorContainer elevation={2} data-testid={dataTestId || 'code-editor'}>
      {showToolbar && (
        <EditorToolbar
          copy={copy}
          language={language}
          readOnly={readOnly}
          isWrapped={editor.isWrapped}
          isCopied={editor.isCopied}
          isFullscreen={editor.isFullscreen}
          dataTestId={dataTestId}
          onFormat={editor.handleFormat}
          onCopy={editor.handleCopy}
          onWrapToggle={editor.handleWrapToggle}
          onFullscreenToggle={editor.handleFullscreenToggle}
        />
      )}

      <EditorWrapper fullscreen={editor.isFullscreen} data-testid={testId('editor-wrapper')}>
        {placeholder && !value && (
          <PlaceholderOverlay data-testid={testId('placeholder')}>{placeholder}</PlaceholderOverlay>
        )}

        <Editor
          height={editor.isFullscreen ? '100vh' : height}
          language={language}
          value={value}
          onChange={(newValue) => onChange?.(newValue || '')}
          theme={editor.editorTheme}
          options={editorOptions}
          onMount={editor.handleEditorDidMount}
          loading={<EditorLoading label={copy.loading} />}
        />
      </EditorWrapper>
    </EditorContainer>
  );
};
