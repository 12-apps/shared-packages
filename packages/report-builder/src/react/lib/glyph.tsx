/**
 * THE ONE FRAME every glyph in the reports area is drawn in.
 *
 * There were three copies of it — one in `block-icons`, one in `viz-icons`,
 * and a third arrived with the tool cluster (FUT-755). Identical but for the
 * box size, which is the only thing that ever differed: 16px for chrome, 22px
 * for a visualization tile, 28px for the canvas's add-a-block affordance.
 *
 * `currentColor`-driven and `aria-hidden`, so the BUTTON around it carries
 * both the colour and the accessible name. An icon that names itself would be
 * read twice; an icon that names nothing is the worse failure, which is why
 * every caller here is a control with an `aria-label`.
 */
import type { JSX, ReactNode } from "react";

export function Glyph({
  children,
  size = 16,
}: {
  children: ReactNode;
  /** The box, in px. The stroke does not scale with it — that is deliberate. */
  size?: number;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
