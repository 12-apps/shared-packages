// Selection surgery for the editor. Each of these mutates the DOM around a
// Range and then rebuilds the selection, so the caret ends up where the user
// expects rather than at the start of the document.

const wrapSelection = (range: globalThis.Range, tagName: string) => {
  const selectedText = range.toString();
  if (!selectedText) return;
  
  const wrapper = document.createElement(tagName);
  wrapper.appendChild(document.createTextNode(selectedText));
  
  range.deleteContents();
  range.insertNode(wrapper);
  
  // Move cursor after inserted element
  const newRange = document.createRange();
  newRange.setStartAfter(wrapper);
  newRange.collapse(true);
  
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(newRange);
};

const wrapSelectionWithLink = (range: globalThis.Range, url: string) => {
  const selectedText = range.toString();
  if (!selectedText) return;
  
  const link = document.createElement('a');
  link.href = url.startsWith('http') ? url : `https://${url}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.appendChild(document.createTextNode(selectedText));
  
  range.deleteContents();
  range.insertNode(link);
  
  // Move cursor after inserted element
  const newRange = document.createRange();
  newRange.setStartAfter(link);
  newRange.collapse(true);
  
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(newRange);
};

const insertImage = (range: globalThis.Range, src: string) => {
  const img = document.createElement('img');
  img.src = src;
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  
  range.deleteContents();
  range.insertNode(img);
  
  // Move cursor after inserted element
  const newRange = document.createRange();
  newRange.setStartAfter(img);
  newRange.collapse(true);
  
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(newRange);
};

// Resolves to the nearest element, since a collapsed selection reports its text
// node as the common ancestor.
const blockElementFor = (range: globalThis.Range): globalThis.Element | null => {
  const node = range.commonAncestorContainer;

  return node.nodeType === globalThis.Node.TEXT_NODE
    ? node.parentElement
    : (node as globalThis.Element);
};

// Unwraps the item back to plain text, keeping its content.
const removeFromList = (block: globalThis.Element) => {
  const listItem = block.closest('li');
  if (!listItem?.parentElement) return;

  listItem.parentElement.replaceChild(
    document.createTextNode(listItem.textContent || ''),
    listItem,
  );
};

const wrapInList = (range: globalThis.Range, listType: 'ol' | 'ul') => {
  const list = document.createElement(listType);
  const listItem = document.createElement('li');

  listItem.appendChild(document.createTextNode(range.toString() || 'List item'));
  list.appendChild(listItem);

  range.deleteContents();
  range.insertNode(list);

  // Move cursor inside list item
  const newRange = document.createRange();
  newRange.selectNodeContents(listItem);
  newRange.collapse(false);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(newRange);
};

const toggleList = (
  range: globalThis.Range,
  listType: 'ol' | 'ul',
  editor: HTMLElement | null,
) => {
  if (!editor) return;

  const block = blockElementFor(range);
  if (!block) return;

  if (block.closest(listType)) {
    removeFromList(block);
    return;
  }

  wrapInList(range, listType);
};

// Simple inline formats are a tag swap; lists and the value-carrying formats
// need their own handling. This was one nine-case switch.
const WRAP_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strikethrough: 's',
};

const LIST_TAGS: Record<string, 'ol' | 'ul'> = {
  insertOrderedList: 'ol',
  insertUnorderedList: 'ul',
};

// formatBlock is the only format whose value names the tag, and only these two
// are accepted.
const BLOCK_TAGS = new Set(['pre', 'blockquote']);

export const applyFormatToRange = ({
  formatType,
  value,
  range,
  editor,
}: {
  formatType: string;
  value?: string;
  range: globalThis.Range;
  editor: HTMLElement | null;
}) => {
  const wrapTag = WRAP_TAGS[formatType];
  if (wrapTag) {
    wrapSelection(range, wrapTag);
    return;
  }

  const listTag = LIST_TAGS[formatType];
  if (listTag) {
    toggleList(range, listTag, editor);
    return;
  }

  if (formatType === 'createLink' && value) {
    wrapSelectionWithLink(range, value);
    return;
  }

  if (formatType === 'insertImage' && value) {
    insertImage(range, value);
    return;
  }

  if (formatType === 'formatBlock' && value && BLOCK_TAGS.has(value)) {
    wrapSelection(range, value);
  }
};
