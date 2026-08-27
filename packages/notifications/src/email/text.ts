import type { EmailDocument } from './template';

/**
 * The plain-text half.
 *
 * Not a courtesy. Every major spam filter scores a `text/html` part with no
 * `text/plain` twin, and a watch, a terminal client and a screen reader in
 * plain-text mode show this and nothing else.
 *
 * It renders from the SAME `EmailDocument` the HTML half does, which is the
 * property that matters: a line added to one is in the other, so the two cannot
 * drift. Its own module only because the HTML renderer is already a file's
 * worth of client workarounds — the seam is the output format, not the content.
 */

/**
 * Render the document as the plain-text half.
 *
 * Not a courtesy. Every major spam filter scores a `text/html` part with no
 * `text/plain` twin, and a watch, a terminal client and a screen reader in
 * plain-text mode show this and nothing else. It is rendered from the SAME
 * object, so it cannot say less than the HTML does.
 */
export function renderEmailText(document: EmailDocument): string {
  const blocks = [
    document.heading,
    "",
    ...textParagraphs(document),
    ...textFacts(document),
    ...textAction(document),
    ...textNotes(document),
    "--",
    document.chrome.tagline(document.brand),
    document.chrome.automated,
  ];
  return `${blocks.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** One blank line after each paragraph, as prose reads. */
function textParagraphs(document: EmailDocument): string[] {
  return (document.paragraphs ?? []).flatMap((text) => [text, ""]);
}

/** `Label: value` per row, as a receipt is quoted back over the phone. */
function textFacts(document: EmailDocument): string[] {
  const rows = document.facts ?? [];
  return rows.length === 0 ? [] : [...rows.map((f) => `${f.label}: ${f.value}`), ""];
}

/** The CTA as label + URL: a plain-text reader has no button to press. */
function textAction(document: EmailDocument): string[] {
  return document.action ? [`${document.action.label}: ${document.action.href}`, ""] : [];
}

function textNotes(document: EmailDocument): string[] {
  const notes = document.notes ?? [];
  return notes.length === 0 ? [] : [...notes, ""];
}

