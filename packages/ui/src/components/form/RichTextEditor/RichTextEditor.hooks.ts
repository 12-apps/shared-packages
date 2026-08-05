import DOMPurify from 'dompurify';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { applyFormatToRange } from './RichTextEditor.format';

// Deliberately narrow: anything not listed is stripped, and no data-* attributes
// survive, so pasted markup cannot smuggle in behaviour.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'a', 'img', 'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'target', 'rel', 'style', 'class'],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
};

const textLengthOf = (html: string): number => {
  const probe = document.createElement('div');
  probe.innerHTML = html;
  return probe.textContent?.length || 0;
};

// The editable content and the limit that guards it.
const useEditorContent = ({
  editorRef,
  value,
  onChange,
  maxLength,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
}) => {
  const [content, setContent] = useState(value ?? '');

  const handleContentChange = useCallback(() => {
    if (!editorRef.current) return;

    const newContent = editorRef.current.innerHTML;

    // Over the limit, put the last accepted content back rather than truncating
    // mid-markup.
    if (maxLength && (editorRef.current.textContent || '').length > maxLength) {
      editorRef.current.innerHTML = content;
      return;
    }

    setContent(newContent);
    onChange?.(newContent);
  }, [maxLength, onChange, content, editorRef]);

  return { content, handleContentChange };
};

const useFocusState = ({ onFocus, onBlur }: { onFocus?: () => void; onBlur?: () => void }) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onBlur?.();
  }, [onBlur]);

  return { isFocused, handleFocus, handleBlur };
};

export const useRichTextEditor = ({
  value,
  onChange,
  onFocus,
  onBlur,
  disabled,
  readOnly,
  maxLength,
}: {
  value?: string;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const { content, handleContentChange } = useEditorContent({
    editorRef,
    value,
    onChange,
    maxLength,
  });
  const { isFocused, handleFocus, handleBlur } = useFocusState({ onFocus, onBlur });

  const applyFormat = useCallback(
    (formatType: string, formatValue?: string) => {
      if (disabled || readOnly || !editorRef.current) return;

      const selection = window.getSelection();
      // Nothing selected: give the editor focus so the next keystroke lands.
      if (!selection || selection.rangeCount === 0) {
        editorRef.current.focus();
        return;
      }

      applyFormatToRange({
        formatType,
        value: formatValue,
        range: selection.getRangeAt(0),
        editor: editorRef.current,
      });

      handleContentChange();
      editorRef.current.focus();
    },
    [disabled, readOnly, handleContentChange],
  );

  const sanitizedContent = DOMPurify.sanitize(content, SANITIZE_CONFIG);

  // Reflect the sanitized result back when it differs from what is on screen.
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== sanitizedContent) {
      editorRef.current.innerHTML = sanitizedContent;
    }
  }, [sanitizedContent]);

  return {
    editorRef,
    isFocused,
    characterCount: textLengthOf(sanitizedContent),
    handleContentChange,
    handleFocus,
    handleBlur,
    applyFormat,
  };
};
