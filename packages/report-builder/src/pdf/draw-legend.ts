import type { Color } from 'pdf-lib';

import type { TextStyle } from './canvas';
import { INK_MUTED } from './theme';
import type { PdfPaintContext } from './types';

export interface LegendEntry {
  label: string;
  color: Color;
}

const STYLE: TextStyle = { size: 8, color: INK_MUTED };
const SWATCH = 7;
const GAP = 12;
export const LEGEND_LINE = 12;

/** Entries packed left to right, a new line where the next one would overflow. */
export function legendLines(ctx: PdfPaintContext, entries: readonly LegendEntry[], width: number): LegendEntry[][] {
  const lines: LegendEntry[][] = [];
  let used = 0;
  for (const entry of entries) {
    const need = SWATCH + 4 + ctx.canvas.width(entry.label, STYLE) + GAP;
    const last = lines[lines.length - 1];
    if (!last || used + need > width) {
      lines.push([entry]);
      used = need;
    } else {
      last.push(entry);
      used += need;
    }
  }
  return lines;
}

export function drawLegend(ctx: PdfPaintContext, lines: LegendEntry[][], x: number, top: number): void {
  lines.forEach((line, row) => {
    let left = x;
    for (const entry of line) {
      const y = top + row * LEGEND_LINE;
      ctx.canvas.rect(left, y + 1, SWATCH, SWATCH, entry.color);
      ctx.canvas.text(entry.label, left + SWATCH + 4, y, STYLE);
      left += SWATCH + 4 + ctx.canvas.width(entry.label, STYLE) + GAP;
    }
  });
}
