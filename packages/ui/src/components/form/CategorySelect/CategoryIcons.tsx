/**
 * The prototype's four glyphs, inlined.
 *
 * Inline SVG rather than `@mui/icons-material` because these are drawn at the
 * design's own weights (2.4 for the chevrons, 3.2 for the tick) and sizes; the
 * Material set is a 24px grid at a fixed weight and would not land on the same
 * pixels.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** The tick inside a checked box. */
export function CheckGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={3.2} aria-hidden="true" {...STROKE}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** The disclosure chevron on a category row (points right; rotates when open). */
export function DisclosureGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={2.4} aria-hidden="true" {...STROKE}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

/** The trigger's caret (points down; rotates when the panel is open). */
export function CaretGlyph({ style }: { style?: React.CSSProperties }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={2.4} style={style} aria-hidden="true" {...STROKE}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The magnifier in the panel's search field. */
export function SearchGlyph({ style }: { style?: React.CSSProperties }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={2} style={style} aria-hidden="true" {...STROKE}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
