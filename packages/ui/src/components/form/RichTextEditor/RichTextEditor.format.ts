import {
  insertImage,
  toggleList,
  wrapSelection,
  wrapSelectionWithLink,
} from './RichTextEditor.dom';

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

