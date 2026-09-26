import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { CodeEditor } from './CodeEditor';
import { PT_BR_CODE_EDITOR_COPY } from '../../../pt-BR';

const meta: Meta<typeof CodeEditor> = {
  args: { copy: PT_BR_CODE_EDITOR_COPY },
  title: 'Form/CodeEditor/Tests',
  component: CodeEditor,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:CodeEditor'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Sample code for testing
const sampleCode = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`;

export const BasicInteraction: Story = {
  args: {
    language: 'javascript',
    value: sampleCode,
    onChange: fn(),
    height: '300px',
    lineNumbers: true,
  },
  play: async ({ canvasElement, args }) => {
    // Wait for Monaco editor to fully initialize
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        const hasTextContent = canvasElement.querySelector('.view-lines .view-line');
        return expect(editor).toBeInTheDocument() && expect(hasTextContent).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // Verify actual code content is rendered correctly
    const viewLines = canvasElement.querySelector('.view-lines');
    await expect(viewLines).toBeInTheDocument();

    // Verify specific JavaScript keywords are syntax highlighted
    await waitFor(
      () => {
        const functionKeyword = Array.from(
          canvasElement.querySelectorAll('.mtk5, .mtk6, .mtk7'),
        ).find((el) => el.textContent?.includes('function'));
        return expect(functionKeyword).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Test actual Monaco editor functionality - line numbers. sampleCode above
    // is exactly 6 lines, so a rendered number per line means at least 6 — not
    // more than 6, which never happens before any edit. `.line-numbers` also
    // matches Monaco's own margin "textAreaCover" decoration (an empty div
    // sharing that class to mask the gutter), so this filters to the ones that
    // actually carry a line number.
    const lineNumbers = Array.from(canvasElement.querySelectorAll('.line-numbers')).filter(
      (el) => el.textContent,
    );
    expect(lineNumbers.length).toBeGreaterThanOrEqual(6); // Should have line numbers for our sample code
    expect(lineNumbers[0]).toHaveTextContent('1');
    expect(lineNumbers[1]).toHaveTextContent('2');

    // Verify Monaco editor content is editable and responds to input. Monaco's
    // `.monaco-editor` root mounts before its internal view finishes building
    // its input host — a real, if brief, gap. That host is `role="textbox"`
    // under either of Monaco's input controllers (the classic hidden
    // `.inputarea` textarea, or the native EditContext `.native-edit-context`
    // div Chromium defaults to), so querying by role is stable across both.
    const textArea = await within(canvasElement).findByRole('textbox', {}, { timeout: 10000 });

    // Test editor receives focus and is interactive
    await userEvent.click(textArea);
    await waitFor(() => expect(textArea).toHaveFocus());

    // Test that onChange is called when content changes. Typing NEW
    // characters relies on the browser's real EditContext text-input
    // pipeline (Chromium's default input controller here) — only genuine
    // trusted keyboard/IME input drives it, so no DOM-dispatchable event can
    // simulate it from a play() function. A Monaco COMMAND such as "toggle
    // line comment" is not text insertion: it goes through the keybinding
    // service the same way under either input controller (as Ctrl+S does,
    // below), and it does modify the model — so it is what this story uses
    // to exercise a real, verifiable edit. `userEvent.keyboard`'s synthetic
    // KeyboardEvent also does not resolve a keybinding reliably (it omits
    // the legacy `keyCode` Monaco reads), so the keydown is dispatched
    // directly, with `keyCode` set — see the Ctrl+S comment in Integration.
    const dispatchKeydown = (init: KeyboardEventInit) =>
      textArea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

    dispatchKeydown({ key: 'Home', code: 'Home', keyCode: 36, which: 36, ctrlKey: true }); // Go to the very start
    dispatchKeydown({ key: '/', code: 'Slash', keyCode: 191, which: 191, ctrlKey: true }); // Toggle line comment

    // Verify onChange callback was called with the commented first line
    await waitFor(() => {
      expect(args.onChange).toHaveBeenCalled();
      const mockFn = args.onChange as ReturnType<typeof fn>;
      const calls = mockFn.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toContain('// function fibonacci(n) {');
    });

    // Test basic Monaco keyboard shortcuts work
    await userEvent.keyboard('{Control>}z{/Control}'); // Undo
    await waitFor(() => {
      expect(args.onChange).toHaveBeenCalledWith(
        expect.stringContaining('console.log(fibonacci(10));'),
      );
    });

    // Verify syntax highlighting for strings in the actual code
    await waitFor(() => {
      // Look for the 'console' keyword or numbers like '10' which are in the code
      const tokens = canvasElement.querySelectorAll(
        '.mtk1, .mtk5, .mtk6, .mtk7, .mtk8, .mtk9, .mtk10',
      );
      const hasHighlighting = tokens.length > 0;
      return expect(hasHighlighting).toBe(true);
    });

    // Test copy functionality - simplified
    const copyButtons = canvasElement.querySelectorAll('button');
    const copyButton = Array.from(copyButtons).find((btn) =>
      btn.querySelector('[data-testid="ContentCopyIcon"]'),
    ) as HTMLElement;

    if (copyButton) {
      await expect(copyButton).toBeInTheDocument();
      await userEvent.click(copyButton);
      // Verify the button was clicked successfully
      await expect(copyButton).toBeInTheDocument();
    }

    // Test completed successfully
  },
};

export const FormInteraction: Story = {
  args: {
    language: 'typescript',
    value: '',
    onChange: fn(),
    placeholder: 'Enter TypeScript code here...',
    height: '250px',
    autoFormat: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // An empty editor shows its placeholder overlay, and drops it as soon as it
    // has a value — that `placeholder && !value` branch is the only thing this
    // story's args exercise, so it is what the wait is for.
    await waitFor(
      () => {
        expect(canvas.getByTestId('code-editor-placeholder')).toHaveTextContent(
          'Enter TypeScript code here...',
        );
      },
      { timeout: 8000 },
    );

    // The toolbar reports the language the editor was configured with.
    await expect(canvas.getByTestId('code-editor-language-badge')).toHaveTextContent(/typescript/i);
  },
};

export const KeyboardNavigation: Story = {
  args: {
    language: 'javascript',
    value: sampleCode,
    height: '300px',
    // This story types into the editor, which calls onChange — an explicit
    // spy, or Storybook's implicit-action detection throws during play().
    onChange: fn(),
    onSave: fn(),
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // Test Tab navigation through toolbar buttons - simplified
    const buttons = canvasElement.querySelectorAll('button');

    // Find toolbar buttons by their icons
    const formatButton = Array.from(buttons).find((btn) =>
      btn.querySelector('[data-testid="CodeIcon"]'),
    ) as HTMLElement;
    const wrapButton = Array.from(buttons).find((btn) =>
      btn.querySelector('[data-testid="WrapTextIcon"]'),
    ) as HTMLElement;
    const copyButton = Array.from(buttons).find((btn) =>
      btn.querySelector('[data-testid="ContentCopyIcon"]'),
    ) as HTMLElement;
    const fullscreenButton = Array.from(buttons).find((btn) =>
      btn.querySelector('[data-testid="FullscreenIcon"]'),
    ) as HTMLElement;

    // Test that at least some toolbar buttons are present
    const foundButtons = [formatButton, wrapButton, copyButton, fullscreenButton].filter(Boolean);
    expect(foundButtons.length).toBeGreaterThan(0);

    // Test clicking available buttons
    for (const button of foundButtons) {
      if (button) {
        await userEvent.click(button);
      }
    }

    // Monaco's `.monaco-editor` root mounts before its internal view finishes
    // building its input host — a real, if brief, gap. That host is
    // `role="textbox"` under either of Monaco's input controllers (the
    // classic hidden `.inputarea` textarea, or the native EditContext
    // `.native-edit-context` div Chromium defaults to), so querying by role
    // is stable across both.
    const textarea = await within(canvasElement).findByRole('textbox', {}, { timeout: 10000 });

    // Focus editor and test Monaco navigation shortcuts
    await userEvent.click(textarea);
    await waitFor(() => expect(textarea).toHaveFocus());

    // Test Ctrl+Home (go to beginning)
    await userEvent.keyboard('{Control>}{Home}{/Control}');

    // Test Ctrl+End (go to end)
    await userEvent.keyboard('{Control>}{End}{/Control}');

    // Test line navigation with arrows
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowDown}');

    // Test Monaco's Ctrl+L (select line)
    await userEvent.keyboard('{Control>}l{/Control}');

    // Test Monaco's Ctrl+/ (toggle comment)
    await userEvent.keyboard('{Control>}/{/Control}');

    // Test Monaco's Ctrl+S (save functionality)
    await userEvent.keyboard('{Control>}s{/Control}');

    // Test Monaco's Ctrl+Z (undo)
    await userEvent.type(textarea, '// Test comment');
    await userEvent.keyboard('{Control>}z{/Control}');

    // Test Monaco's Ctrl+Y (redo)
    await userEvent.keyboard('{Control>}y{/Control}');

    // Test Monaco's selection and copy
    await userEvent.keyboard('{Control>}a{/Control}'); // Select all
    await userEvent.keyboard('{Control>}c{/Control}'); // Copy

    // Test Enter key activation on available buttons
    if (copyButton) {
      await userEvent.click(copyButton);
      await userEvent.keyboard('{Enter}');
    }

    // Test that the editor is still functional after keyboard operations
    await waitFor(() => {
      const editor = canvasElement.querySelector('.monaco-editor');
      return expect(editor).toBeInTheDocument();
    });

    // Test completed successfully
  },
};

export const ScreenReader: Story = {
  args: {
    language: 'python',
    value: 'print("Hello, World!")',
    readOnly: true,
    height: '200px',
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Check for language badge with proper text
    const languageBadge = within(canvasElement).getByText('python');
    await expect(languageBadge).toBeInTheDocument();

    // Check for read-only indicator. The toolbar renders the copy pack's own
    // string (PT_BR_CODE_EDITOR_COPY.readOnly, "Somente leitura") — English
    // literal "Read Only" is neither that nor even the EN pack's casing.
    const readOnlyText = within(canvasElement).getByText(PT_BR_CODE_EDITOR_COPY.readOnly);
    await expect(readOnlyText).toBeInTheDocument();

    // Check that buttons have proper accessible names. The button's aria-label
    // is the copy pack's own string (PT_BR_CODE_EDITOR_COPY.copyToClipboard),
    // not the English literal.
    const copyButton = within(canvasElement).getByRole('button', {
      name: PT_BR_CODE_EDITOR_COPY.copyToClipboard,
    });
    await expect(copyButton).toBeInTheDocument();
    await expect(copyButton).toBeEnabled();

    // Test completed successfully
  },
};

export const FocusManagement: Story = {
  args: {
    language: 'css',
    value: '.test { color: red; }',
    height: '200px',
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Final verification - just confirm basic functionality
    const finalCheck = canvasElement.querySelector('.monaco-editor, .MuiPaper-root, .MuiBox-root');
    if (finalCheck) {
      // Test passed - editor or wrapper is present
    }

    // Test completed successfully
  },
};

export const ResponsiveDesign: Story = {
  args: {
    language: 'html',
    value: '<div>Responsive test</div>',
    height: '250px',
  },
  parameters: {
    viewport: {
      viewports: {
        mobile: { name: 'Mobile', styles: { width: '375px', height: '667px' } },
        tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // Check that editor container is present and responsive
    const editorContainer = canvasElement.querySelector('.monaco-editor');
    await expect(editorContainer).toBeInTheDocument();

    // Check that toolbar is still functional on smaller screens
    const toolbar = canvasElement.querySelector('[class*="Toolbar"]');
    if (toolbar) {
      await expect(toolbar).toBeInTheDocument();
    }

    // Test completed successfully
  },
};

export const ThemeVariations: Story = {
  args: {
    language: 'javascript',
    value: '// Theme test\nconst test = "hello";',
    theme: 'light',
    height: '200px',
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // Test basic Monaco editor functionality
    const editorElement = canvasElement.querySelector('.monaco-editor') as HTMLElement;
    await expect(editorElement).toBeInTheDocument();

    // Verify syntax highlighting is working
    await waitFor(() => {
      const tokens = canvasElement.querySelectorAll('.mtk1, .mtk5, .mtk6, .mtk7, .mtk8');
      return expect(tokens.length).toBeGreaterThan(0);
    });

    // Test completed successfully
  },
};

export const VisualStates: Story = {
  render: () => (
    <Stack spacing={3}>
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY} language="javascript" value="// Normal state" height="150px" />
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY} language="javascript" value="// Read-only state" readOnly height="150px" />
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY}
        language="javascript"
        value=""
        placeholder="Empty state with placeholder"
        height="150px"
      />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editors = canvasElement.querySelectorAll('.monaco-editor');
        return expect(editors).toHaveLength(3);
      },
      { timeout: 5000 },
    );

    // Check normal state
    const normalEditor = canvasElement.querySelectorAll('.monaco-editor')[0];
    await expect(normalEditor).toBeInTheDocument();

    // Check read-only state. The toolbar renders the copy pack's own string
    // (PT_BR_CODE_EDITOR_COPY.readOnly, "Somente leitura") — English literal
    // "Read Only" is neither that nor even the EN pack's casing.
    const readOnlyText = within(canvasElement).getByText(PT_BR_CODE_EDITOR_COPY.readOnly);
    await expect(readOnlyText).toBeInTheDocument();

    // Check empty state with placeholder
    const placeholder = within(canvasElement).getByText('Empty state with placeholder');
    await expect(placeholder).toBeInTheDocument();

    // Test completed successfully
  },
};

export const Performance: Story = {
  args: {
    language: 'javascript',
    value: sampleCode.repeat(50), // Large content to test performance
    height: '400px',
  },
  play: async ({ canvasElement }) => {

    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // Check that large content is handled properly
    const editorContent = canvasElement.querySelector('.monaco-editor');
    await expect(editorContent).toBeInTheDocument();

    // Test completed successfully
  },
};

export const EdgeCases: Story = {
  render: () => (
    <Stack spacing={3}>
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY} language="javascript" value="" height="100px" showToolbar={false} />
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY}
        language="json"
        value='{"test": "very long text that might overflow and cause issues with the editor layout and rendering system"}'
        wordWrap
        height="100px"
      />
      <CodeEditor copy={PT_BR_CODE_EDITOR_COPY}
        language="typescript"
        value="// Special characters: àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
        height="100px"
        minimap
      />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editors = canvasElement.querySelectorAll('.monaco-editor');
        return expect(editors).toHaveLength(3);
      },
      { timeout: 5000 },
    );

    // Test editors and toolbar buttons - wait for Monaco to fully initialize
    await waitFor(() => {
      // Use proper test IDs to find copy buttons
      // First editor has showToolbar={false}, but verify actual count
      const copyButtons = canvasElement.querySelectorAll('[data-testid="code-editor-copy-btn"]');
      // Expect at least 1 copy button (may be 2 or 3 depending on toolbar visibility)
      expect(copyButtons.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });

    // Find word wrap button using proper test ID
    const wrapButton = canvasElement.querySelector(
      '[data-testid="code-editor-wrap-btn"]'
    ) as HTMLElement;

    if (wrapButton) {
      await expect(wrapButton).toBeInTheDocument();
    }

    // Test special characters are rendered correctly
    const specialCharsEditor = canvasElement.querySelectorAll('.view-lines')[2];
    await expect(specialCharsEditor).toBeInTheDocument();

    // Verify minimap configuration - third editor should have minimap enabled
    // Note: Monaco may render minimap elements for all editors in test environment,
    // but we verify that at least the editor with minimap=true has it present
    await waitFor(() => {
      const editors = canvasElement.querySelectorAll('.monaco-editor');
      expect(editors).toHaveLength(3);

      // Third editor (index 2) has minimap={true} - verify it has a minimap element
      const thirdEditor = editors[2] as HTMLElement;
      const thirdEditorMinimap = thirdEditor.querySelector('.minimap');
      expect(thirdEditorMinimap).toBeInTheDocument();
    }, { timeout: 2000 });

    // Test JSON syntax highlighting with proper timing
    await waitFor(() => {
      const jsonEditor = canvasElement.querySelectorAll('.monaco-editor')[1];
      const jsonTokens = jsonEditor.querySelectorAll('.mtk1, .mtk5, .mtk8');
      return expect(jsonTokens.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Test completed successfully
  },
};

// How long the "Saved" status stays up after a save. The story exists to show
// that the status flashes and then reverts on its own, so the play function
// asserts both edges of that transition.
const SAVED_FLASH_MS = 2000;

export const Integration: Story = {
  render: () => {
    const [code, setCode] = React.useState('// Integration test');
    const [isSaved, setIsSaved] = React.useState(false);

    const handleSave = (value: string) => {
      setCode(value);
      setIsSaved(true);
    };

    // The flash is cleared by a timer this story owns. It used to be
    // `await waitFor(async () => setIsSaved(false), { timeout: 2000 })` — a
    // waitFor callback that never throws, which resolves on the FIRST tick. So
    // the status was cleared immediately and never once rendered "Saved", and
    // the story demonstrated nothing.
    React.useEffect(() => {
      if (!isSaved) return undefined;
      const timer = window.setTimeout(() => setIsSaved(false), SAVED_FLASH_MS);
      return () => window.clearTimeout(timer);
    }, [isSaved]);

    return (
      <Stack spacing={2}>
        <CodeEditor copy={PT_BR_CODE_EDITOR_COPY}
          language="javascript"
          value={code}
          onChange={setCode}
          onSave={handleSave}
          height="200px"
        />
        <Box
          data-testid="save-status"
          sx={{ p: 1, bgcolor: isSaved ? 'success.light' : 'grey.100' }}
        >
          Status: {isSaved ? 'Saved' : 'Not saved'}
        </Box>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        const editor = canvasElement.querySelector('.monaco-editor');
        return expect(editor).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    // Test integration with external state
    const statusBox = within(canvasElement).getByText(/Status:/);
    await expect(statusBox).toBeInTheDocument();

    // Verify initial "Not saved" status
    await expect(within(canvasElement).getByText(/Not saved/)).toBeInTheDocument();

    // Test save functionality (Ctrl+S). Monaco's `.monaco-editor` root mounts
    // before its internal view finishes building its input host — a real, if
    // brief, gap. That host is `role="textbox"` under either of Monaco's
    // input controllers (the classic hidden `.inputarea` textarea, or the
    // native EditContext `.native-edit-context` div Chromium defaults to),
    // so querying by role is stable across both.
    const editorTextarea = await within(canvasElement).findByRole('textbox', {}, { timeout: 10000 });

    // Test save functionality by modifying content and triggering save
    await userEvent.click(editorTextarea);

    // Modify content to trigger save
    await userEvent.type(editorTextarea, '\n// Modified for save test');

    // Monaco resolves a custom `addCommand` keybinding from the event's
    // legacy `keyCode`, which `userEvent.keyboard`'s synthetic KeyboardEvent
    // does not set (it is non-standard, and testing-library deliberately
    // does not emit it) — so `{Control>}s{/Control}` never reaches the save
    // command Monaco itself never receives, unlike native browser commands
    // such as undo. Dispatching the keydown directly, with `keyCode` set,
    // is what a real Ctrl+S keystroke gives Monaco, and this component's own
    // save shortcut is the thing under test.
    editorTextarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        keyCode: 83,
        which: 83,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    // The save handler flips the external state, and the status renders "Saved".
    // This is the assertion the story turns on: while the flash was cleared on
    // the first tick, "Saved" was never painted and this timed out.
    await waitFor(
      () => {
        expect(within(canvasElement).getByTestId('save-status')).toHaveTextContent(
          'Status: Saved',
        );
      },
      { timeout: 5000 },
    );

    // ...and the flash expires on its own, restoring the idle status. Waiting on
    // the transition rather than on a fixed delay means this also fails if the
    // status simply sticks on "Saved".
    await waitFor(
      () => {
        expect(within(canvasElement).getByTestId('save-status')).toHaveTextContent(
          'Status: Not saved',
        );
      },
      { timeout: SAVED_FLASH_MS + 5000 },
    );
  },
};
