import type { TicketLine } from "./model";
import { FONT_CELL_DOTS, LINE_SIZE_METRICS } from "./sizes";

/**
 * What a line prints in, resolved once so both encoders read the same answer.
 *
 * Internal: not a package export. The public statement of the mapping is
 * `LINE_SIZE_METRICS`; this adds the legacy emphases on top of it.
 */
export interface ResolvedStyle {
  font: "A" | "B";
  widthMultiplier: 1 | 2;
  heightMultiplier: 1 | 2;
  bold: boolean;
  /** Height of one printed line in dots, with no gap under it. */
  cellHeightDots: number;
}

/** `bold` and `double` are both bold; anything else — including a value from a
 * newer or older host that this version does not know — prints plain. */
const isBold = (line: TicketLine): boolean => line.emphasis === "bold" || line.emphasis === "double";

export function resolveStyle(line: TicketLine): ResolvedStyle {
  if (line.size !== undefined) {
    const { font, multiplier } = LINE_SIZE_METRICS[line.size] ?? LINE_SIZE_METRICS.medium;
    return {
      font,
      widthMultiplier: multiplier,
      heightMultiplier: multiplier,
      bold: isBold(line),
      cellHeightDots: FONT_CELL_DOTS[font].height * multiplier,
    };
  }
  // No size: the original model. `double` is Font A, bold, double HEIGHT only.
  const double = line.emphasis === "double";
  return {
    font: "A",
    widthMultiplier: 1,
    heightMultiplier: double ? 2 : 1,
    bold: isBold(line),
    cellHeightDots: FONT_CELL_DOTS.A.height * (double ? 2 : 1),
  };
}
