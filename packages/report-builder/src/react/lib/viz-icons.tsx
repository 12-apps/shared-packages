/**
 * One glyph per visualization (FUT-391), inline and dependency-free like the
 * block chrome's icons. `currentColor`-driven, so the button's own colour
 * carries them — including the dimmed state of a disabled option.
 *
 * They are drawn as the SHAPE the option produces rather than as an abstract
 * symbol: the picker's whole job is letting an author recognise the rendering
 * they want without reading seven labels.
 */
import type { JSX, ReactNode } from "react";

import type { ChartKind } from "../builder-model";
import { Glyph as IconFrame } from "./glyph";

/** A tile's glyph is drawn larger than the chrome's — 22px, not 16. */
function Glyph({ children }: { children: ReactNode }): JSX.Element {
  return <IconFrame size={22}>{children}</IconFrame>;
}

const ICONS: Record<ChartKind, JSX.Element> = {
  table: (
    <Glyph>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M3 14.5h18M9 4v16" />
    </Glyph>
  ),
  kpi: (
    <Glyph>
      <path d="M5 15V9M5 9l3 3 3-4M14 8h5M14 12h5M14 16h3" />
    </Glyph>
  ),
  line: (
    <Glyph>
      <path d="M4 19V5M4 19h16" />
      <path d="M7 15l4-5 3 3 4-6" />
    </Glyph>
  ),
  bar: (
    <Glyph>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 19v-6M12.5 19v-9M17 19v-4" />
    </Glyph>
  ),
  area: (
    <Glyph>
      <path d="M4 19V5M4 19h16" />
      <path d="M6 16l4-5 3 3 5-6v7z" />
    </Glyph>
  ),
  pie: (
    <Glyph>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12V4M12 12l6.5 4" />
    </Glyph>
  ),
  donut: (
    <Glyph>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v4.5" />
    </Glyph>
  ),
};

export function VizIcon({ kind }: { kind: ChartKind }): JSX.Element {
  return ICONS[kind];
}
