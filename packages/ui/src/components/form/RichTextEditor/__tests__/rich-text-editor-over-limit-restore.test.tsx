/**
 * THE OVER-LIMIT RESTORE IS A DOM SINK, AND IT IS SANITISED (FUT-2685).
 *
 * When an input pushes the text past `maxLength`, the editor puts the last
 * accepted content back into the editable element. Until the first ACCEPTED
 * input, that content is the caller's raw `value`, read once at mount — so the
 * restore used to write stored, unsanitised html straight into the DOM, and an
 * `<img onerror>` carried in `value` ran in a real browser.
 *
 * jsdom loads no images, so `onerror` never fires here. The load-bearing check
 * is therefore the ATTRIBUTE: after the restore, no element in the editor may
 * carry `onerror`. The other two cases pin what the fix must not break —
 * formatting the allow-list keeps survives the restore, and an edit under the
 * limit is accepted exactly as before.
 */
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RichTextEditor } from '../RichTextEditor';

const PAYLOAD = '<img src=x onerror="window.__xss=1">abcde';

const renderEditor = (props: { value: string; maxLength: number; onChange?: (value: string) => void }) => {
  const view = render(<RichTextEditor {...props} />);
  return view.getByTestId('editor-content');
};

const lastTextNode = (node: Node): Text | null => {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (const child of Array.from(node.childNodes).reverse()) {
    const found = lastTextNode(child);
    if (found) return found;
  }
  return null;
};

// What a keystroke does to a contenteditable: the browser mutates the DOM,
// then fires `input`. The character lands at the end of the editor's text.
const typeCharacter = (editor: HTMLElement, character: string) => {
  const target = lastTextNode(editor);
  if (target) target.appendData(character);
  else editor.appendChild(document.createTextNode(character));
  fireEvent.input(editor);
};

describe('Given a stored value carrying an event handler, at the length limit', () => {
  it('then typing one more character restores it with no onerror attribute', async () => {
    const editor = renderEditor({ value: PAYLOAD, maxLength: 5 });

    typeCharacter(editor, 'Z');

    await waitFor(() => {
      expect(editor.textContent).toBe('abcde');
      expect(editor.querySelector('[onerror]')).toBeNull();
    });
  });

  it('then the restore does not emit the rejected edit', async () => {
    const onChange = vi.fn();
    const editor = renderEditor({ value: PAYLOAD, maxLength: 5, onChange });

    typeCharacter(editor, 'Z');

    await waitFor(() => {
      expect(editor.textContent).toBe('abcde');
      expect(editor.querySelector('[onerror]')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Given formatted content at the length limit', () => {
  it('then bold, italic and a list survive the over-limit restore, and the handler does not', async () => {
    const editor = renderEditor({
      value: '<p><strong>ab</strong><em>cd</em></p><ul><li>e<img src=x onerror="window.__xss=1"></li></ul>',
      maxLength: 5,
    });

    typeCharacter(editor, 'Z');

    await waitFor(() => {
      expect(editor.textContent).toBe('abcde');
      expect(editor.querySelector('p > strong')?.textContent).toBe('ab');
      expect(editor.querySelector('p > em')?.textContent).toBe('cd');
      expect(editor.querySelector('ul > li')?.textContent).toBe('e');
      expect(editor.querySelector('[onerror]')).toBeNull();
    });
  });
});

describe('Given an edit that stays under the limit', () => {
  it('then it is accepted and emitted unchanged', async () => {
    const onChange = vi.fn();
    const editor = renderEditor({ value: '<p><strong>ab</strong>c</p>', maxLength: 10, onChange });

    typeCharacter(editor, 'd');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('<p><strong>ab</strong>cd</p>');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(editor.innerHTML).toBe('<p><strong>ab</strong>cd</p>');
  });
});
