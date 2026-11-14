/**
 * A built-in's notes (FUT-4063) as text: which are drawn, where, and with how
 * many names. Pure, so the cap and the hiding are asserted without rendering.
 */
import type { ReportNoteView } from "../reports-api";
import type { ReportSystemCopy } from "../screens-copy";

/** The most names a note lists before "e mais N". */
const NOTE_ITEMS_SHOWN = 3;

/**
 * The defaults for a copy pack that predates the notes' two keys (FUT-4063):
 * language-neutral, so an older pack keeps type-checking and still reads.
 */
const DEFAULT_NOTE_SEPARATOR = "; ";
const defaultNoteMore = (count: number): string => ` +${count}`;

/** Whether a note has anything to say: one that lists names and has none is hidden. */
export function isNoteShown(note: ReportNoteView): boolean {
  return note.items === undefined || note.items.length > 0;
}

/** The note's sentence, its `{items}` replaced by the first three names and "e mais N". */
export function noteText(
  note: ReportNoteView,
  copy: Pick<ReportSystemCopy, "noteSeparator" | "noteMore">,
  /** How many names are listed before "e mais N"; the CSV lists them all. */
  cap = NOTE_ITEMS_SHOWN,
): string {
  if (note.items === undefined) return note.text;
  const separator = copy.noteSeparator ?? DEFAULT_NOTE_SEPARATOR;
  const more = copy.noteMore ?? defaultNoteMore;
  const shown = note.items.slice(0, cap).join(separator);
  const rest = note.items.length - cap;
  const list = rest > 0 ? `${shown}${more(rest)}` : shown;
  return note.text.includes("{items}") ? note.text.split("{items}").join(list) : `${note.text} ${list}`;
}

/**
 * The notes drawn under a block's rendering: shown ones that are not a KPI
 * figure's hint. On the phone, a note that asks to sit BELOW the card is left
 * to {@link notesBelowCard} (FUT-4063).
 */
export function blockNotes(
  notes: readonly ReportNoteView[] | undefined,
  narrow = false,
): ReportNoteView[] {
  return (notes ?? []).filter(
    (note) => note.figure === undefined && isNoteShown(note) && !(narrow && note.phone === "below"),
  );
}

/** On the phone, the notes that sit below the block's card (FUT-4063). */
export function notesBelowCard(notes: readonly ReportNoteView[] | undefined, narrow: boolean): ReportNoteView[] {
  if (!narrow) return [];
  return (notes ?? []).filter((note) => note.figure === undefined && isNoteShown(note) && note.phone === "below");
}

/** Every shown note as the CSV's trailing lines (FUT-4063), hints included. */
export function noteCsvLines(
  notes: readonly ReportNoteView[] | undefined,
  copy: Pick<ReportSystemCopy, "noteSeparator" | "noteMore">,
): string[] {
  // Every name: the export is where the precision the screen caps survives.
  return (notes ?? []).filter(isNoteShown).map((note) => noteText(note, copy, Number.POSITIVE_INFINITY));
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
