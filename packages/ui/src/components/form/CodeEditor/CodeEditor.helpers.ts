import type { CodeEditorProps } from './CodeEditor.types';

// Every element repeated the same conditional test id; this is that ternary once.
export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `code-editor-${suffix}`;

type CodeEditorDefaultedKeys =
  | 'height'
  | 'theme'
  | 'readOnly'
  | 'lineNumbers'
  | 'minimap'
  | 'fontSize'
  | 'wordWrap'
  | 'showToolbar'
  | 'autoFormat';

export type ResolvedCodeEditorProps = CodeEditorProps &
  Required<Pick<CodeEditorProps, CodeEditorDefaultedKeys>>;

const CODE_EDITOR_DEFAULTS: Pick<CodeEditorProps, CodeEditorDefaultedKeys> = {
  height: '400px',
  theme: 'auto',
  readOnly: false,
  lineNumbers: true,
  minimap: false,
  fontSize: 14,
  wordWrap: false,
  showToolbar: true,
  autoFormat: false,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put nine
// branches into the component's own complexity budget.
export const resolveCodeEditorProps = (props: CodeEditorProps): ResolvedCodeEditorProps =>
  ({
    ...CODE_EDITOR_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<CodeEditorProps>),
  }) as ResolvedCodeEditorProps;
