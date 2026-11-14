/**
 * A built-in's notes (FUT-4063) as text: which are drawn, where, and with how
 * many names. Pure, so the cap and the hiding are asserted without rendering.
 */
import type { ReportNoteView } from "../reports-api";
import type { ReportSystemCopy } from "../screens-copy";

/** The most names a note lists before "e mais N". */
export const NOTE_ITEMS_SHOWN = 3;

/** Whether a note has anything to say: one that lists names and has none is hidden. */
export function isNoteShown(note: ReportNoteView): boolean {
  return note.items === undefined || note.items.length > 0;
}

/** The note's sentence, its `{items}` replaced by the first three names and "e mais N". */
export function noteText(
  note: ReportNoteView,
  copy: Pick<ReportSystemCopy, "noteSeparator" | "noteMore">,
): string {
  if (note.items === undefined) return note.text;
  const shown = note.items.slice(0, NOTE_ITEMS_SHOWN).join(copy.noteSeparator);
  const rest = note.items.length - NOTE_ITEMS_SHOWN;
  const list = rest > 0 ? `${shown}${copy.noteMore(rest)}` : shown;
  return note.text.includes("{items}") ? note.text.split("{items}").join(list) : `${note.text} ${list}`;
}

/** The notes drawn under a block: shown ones that are not a KPI figure's hint. */
export function blockNotes(notes: readonly ReportNoteView[] | undefined): ReportNoteView[] {
  return (notes ?? []).filter((note) => note.figure === undefined && isNoteShown(note));
}

/** Each KPI figure's hint, by figure index; the first shown note for a figure wins. */
export function figureHints(
  notes: readonly ReportNoteView[] | undefined,
  copy: Pick<ReportSystemCopy, "noteSeparator" | "noteMore">,
): Map<number, string> {
  const hints = new Map<number, string>();
  for (const note of notes ?? []) {
    if (note.figure === undefined || !isNoteShown(note) || hints.has(note.figure)) continue;
    hints.set(note.figure, noteText(note, copy));
  }
  return hints;
}
