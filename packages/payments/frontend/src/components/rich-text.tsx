'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * `**bold**`, and nothing else.
 *
 * Adapters author their walkthrough as plain strings — the content crosses an
 * HTTP boundary, so it cannot carry markup — but the emphasis is load-bearing
 * copy rather than decoration: `alterar` and `qual conta` are the words that
 * say what the sentence is warning ABOUT. Shouting them in capitals was the
 * workaround, and it reads as a raised voice while being harder to scan.
 *
 * Deliberately not a markdown library. Two asterisks is the entire grammar, an
 * unmatched pair renders verbatim, and nothing here can emit HTML — the text is
 * provider-authored, and a renderer that interpreted more would be an injection
 * surface on a payments screen.
 */
export function richText(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((chunk, index) =>
    index % 2 === 1 ? (
      <strong key={index}>{chunk}</strong>
    ) : (
      <Fragment key={index}>{chunk}</Fragment>
    ),
  );
}
