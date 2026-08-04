/**
 * The three glyphs a block's edit chrome needs (FUT-391), inline and
 * dependency-free: grip (drag to place), pen (edit the query), trash (remove).
 * `currentColor`-driven, so the button's colour fully controls them.
 */
import type { JSX, ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
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

/** Plus — the canvas's add-a-block affordance (drawn larger than the chrome). */
export function PlusIcon(): JSX.Element {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Six-dot drag grip. */
export function GripIcon(): JSX.Element {
  return (
    <Glyph>
      <g strokeWidth={2.4}>
        <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" />
      </g>
    </Glyph>
  );
}

/** Pen — opens the block's query popup. */
export function PencilIcon(): JSX.Element {
  return (
    <Glyph>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </Glyph>
  );
}

/** Trash can — removes the block (behind a confirmation). */
export function TrashIcon(): JSX.Element {
  return (
    <Glyph>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </Glyph>
  );
}
