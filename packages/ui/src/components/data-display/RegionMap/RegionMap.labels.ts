// How the labels over a RegionMap drawing are ranked and laid out.

/** Where a label's centre may go along one axis so the whole label stays in view. */
export function clampCentre(wanted: number, half: number, span: number, gap: number): number {
  if (span <= 2 * (half + gap)) return span / 2;
  return Math.min(span - half - gap, Math.max(half + gap, wanted));
}

/** An area that may carry a label, as {@link labelOrder} ranks it. */
interface Labelable {
  id: string;
  name: string;
  excluded?: boolean;
  geometry: { area: number };
}

/**
 * The order labels claim their place in: highlighted first (what the person is
 * looking for), then excluded, then the larger area, then by name. When two
 * labels would overlap, the earlier one is drawn and the later one hidden.
 */
export function labelOrder<T extends Labelable>(areas: readonly T[], highlighted: ReadonlySet<string>): T[] {
  const rank = (area: T): number => (highlighted.has(area.id) ? 0 : area.excluded ? 1 : 2);
  return [...areas].sort(
    (a, b) => rank(a) - rank(b) || b.geometry.area - a.geometry.area || a.name.localeCompare(b.name),
  );
}

/** A label measured in the drawing: where it wants to be (fractions), and its size in px. */
export interface LabelBox {
  fractionX: number;
  fractionY: number;
  spanX: number;
  spanY: number;
}

/** Where each label goes, in px, and whether it is drawn at all. */
export interface PlacedLabel {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Lay labels out in priority order ({@link labelOrder}): each is pulled inside
 * the drawing by its own size, and one whose box would overlap a label already
 * drawn is hidden — the area keeps its name in its `<title>` and in the list,
 * so hiding costs nothing but the clutter two names over each other made.
 */
export function placeLabels(labels: readonly LabelBox[], box: { spanX: number; spanY: number }, gap: number): PlacedLabel[] {
  const kept: { x0: number; y0: number; x1: number; y1: number }[] = [];
  return labels.map((label) => {
    const x = clampCentre(label.fractionX * box.spanX, label.spanX / 2, box.spanX, gap);
    const y = clampCentre(label.fractionY * box.spanY, label.spanY / 2, box.spanY, gap);
    const rect = { x0: x - label.spanX / 2, y0: y - label.spanY / 2, x1: x + label.spanX / 2, y1: y + label.spanY / 2 };
    const visible = !kept.some((o) => rect.x0 < o.x1 && o.x0 < rect.x1 && rect.y0 < o.y1 && o.y0 < rect.y1);
    if (visible) kept.push(rect);
    return { x, y, visible };
  });
}
