/**
 * Where a marker's tag sits around its pin, so it never hides a stop badge or
 * a place label. Stops and places are geographic truth and never move; only a
 * marker's TAG (its pill and tail) changes side — the pin point stays put.
 *
 * Sides are tried in order — above (the default), below, right, left — and the
 * first whose box touches no stop or place and stays inside the map wins. When
 * none is clear, the side with the least overlap area does (ties keep the
 * earlier side), so a crowded card still reads as well as it can.
 *
 * Geometry is `map.project()` plus each element's layout size (`offsetWidth`,
 * which ignores MapLibre's transform), so it never waits on a repaint.
 */

import { setTagSide, TAG_TAIL_PX, type TagSide } from "./map-elements";
import type { MapLike, MarkerLike } from "./maplibre-types";


const TAG_SIDES: readonly TagSide[] = ["above", "below", "right", "left"];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/** The visible tag (pill plus tail) for a pill of `size`, on `side` of `pin`. */
function tagBox(pin: Point, size: Size, side: TagSide): Box {
  const along = TAG_TAIL_PX;
  if (side === "above") return { left: pin.x - size.width / 2, right: pin.x + size.width / 2, top: pin.y - size.height - along, bottom: pin.y };
  if (side === "below") return { left: pin.x - size.width / 2, right: pin.x + size.width / 2, top: pin.y, bottom: pin.y + along + size.height };
  if (side === "right") return { left: pin.x, right: pin.x + along + size.width, top: pin.y - size.height / 2, bottom: pin.y + size.height / 2 };
  return { left: pin.x - along - size.width, right: pin.x, top: pin.y - size.height / 2, bottom: pin.y + size.height / 2 };
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Inside the map; a map with no laid-out size (not measured yet) bounds nothing. */
function fits(box: Box, bounds: Size): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return true;
  return box.left >= 0 && box.top >= 0 && box.right <= bounds.width && box.bottom <= bounds.height;
}

/**
 * How far clear a side other than the current one must be to win it: a pin
 * jittering a pixel or two at an obstacle's edge must not flip its tag.
 */
const SWITCH_MARGIN_PX = 4;

/** In the least-overlap fallback, leave the current side only for this much less overlap. */
const SWITCH_OVERLAP_RATIO = 0.75;

/**
 * How far past an obstacle's edge a pin that was standing ON it still counts
 * as on it: a pin jittering across a badge's edge must not flip its tag. A
 * pin arriving must be on the badge itself.
 */
const CONTAIN_MARGIN_PX = 6;

function grow(box: Box, by: number): Box {
  return { left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by };
}

function overlapWith(box: Box, obstacles: readonly Box[]): number {
  return obstacles.reduce((sum, obstacle) => sum + overlapArea(box, obstacle), 0);
}

function clear(box: Box, obstacles: readonly Box[], bounds: Size): boolean {
  return overlapWith(box, obstacles) === 0 && fits(box, bounds);
}

function contains(box: Box, point: Point): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

interface Scored {
  side: TagSide;
  overlap: number;
  inside: boolean;
}

function better(a: Scored, b: Scored): boolean {
  if (a.overlap !== b.overlap) return a.overlap < b.overlap;
  return a.inside && !b.inside;
}

/** When every side is blocked: the least overlap, but the current side unless that is a real gain. */
function leastOverlap(pin: Point, size: Size, obstacles: readonly Box[], bounds: Size, current: TagSide): TagSide {
  const scored = TAG_SIDES.map((side): Scored => {
    const box = tagBox(pin, size, side);
    return { side, overlap: overlapWith(box, obstacles), inside: fits(box, bounds) };
  });
  const best = scored.reduce((winner, next) => (better(next, winner) ? next : winner));
  const kept = scored.find((item) => item.side === current)!;
  return best.overlap < kept.overlap * SWITCH_OVERLAP_RATIO ? best.side : current;
}

/**
 * The side for a tag whose pill is `size` on a pin at `pin`, now on `current`:
 *
 * 1. in order, the first side that is the current one and clear, or another
 *    one clear by `SWITCH_MARGIN_PX` — so a tag returns above once an
 *    obstacle has really gone, and never flips on a pixel of jitter;
 * 2. else the first clear side;
 * 3. else the least overlap (keeping the current side unless it is a real gain).
 *
 * The caller leaves out any obstacle under the pin itself (`underPin`).
 */
function chooseSide(pin: Point, size: Size, obstacles: readonly Box[], bounds: Size, current: TagSide = "above"): TagSide {
  const margined = TAG_SIDES.find((side) => {
    const box = tagBox(pin, size, side);
    return side === current ? clear(box, obstacles, bounds) : clear(grow(box, SWITCH_MARGIN_PX), obstacles, bounds);
  });
  if (margined) return margined;
  const first = TAG_SIDES.find((side) => clear(tagBox(pin, size, side), obstacles, bounds));
  return first ?? leastOverlap(pin, size, obstacles, bounds, current);
}

/**
 * The obstacles under the pin's own point (a courier arriving at his stop):
 * they do not block his tag, since every side would clip them about equally.
 * A pin that was `standing` on one keeps it until `CONTAIN_MARGIN_PX` clear.
 */
function underPin(pin: Point, obstacles: readonly Box[], standing: boolean): Box[] {
  const reach = standing ? CONTAIN_MARGIN_PX : 0;
  return obstacles.filter((obstacle) => contains(grow(obstacle, reach), pin));
}

export type Anchor = "bottom" | "center";

/** An element's layout box when MapLibre puts its `anchor` on `point`. */
function anchoredBox(point: Point, anchor: Anchor, size: Size): Box {
  const left = point.x - size.width / 2;
  const top = anchor === "bottom" ? point.y - size.height : point.y - size.height / 2;
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/**
 * The marker offset that keeps the pin on its point for a frame of `size`
 * laid out for `side` (anchor `bottom`: the frame's bottom-centre is the
 * point before the offset).
 */
function offsetFor(side: TagSide, size: Size): [number, number] {
  if (side === "below") return [0, size.height];
  if (side === "right") return [size.width / 2, size.height / 2];
  if (side === "left") return [-size.width / 2, size.height / 2];
  return [0, 0];
}

function sizeOf(element: Element | null | undefined): Size {
  const html = element as HTMLElement | null | undefined;
  return { width: html?.offsetWidth ?? 0, height: html?.offsetHeight ?? 0 };
}

/** What the placement needs from each drawn element. */
export interface Placed {
  marker: MarkerLike;
  element: HTMLElement;
  at: [number, number];
  anchor: Anchor;
  role: "tag" | "stop" | "place";
  /** Whether the pin stood on a stop or place at the last placement (hysteresis). */
  standing?: boolean;
}

/** A stop's badge, or a place's LABEL (a lifted place's stem is not in the way). */
function obstacleOf(map: Pick<MapLike, "project">, item: Placed): Box {
  const frame = anchoredBox(map.project(item.at), item.anchor, sizeOf(item.element));
  const target = item.role === "place" ? (item.element.firstElementChild as HTMLElement | null) : null;
  if (!target) return frame;
  const left = frame.left + target.offsetLeft;
  const top = frame.top + target.offsetTop;
  return { left, top, right: left + target.offsetWidth, bottom: top + target.offsetHeight };
}

/** Move one tag to `side`, re-anchoring its frame so the tail still meets the pin. */
function applySide(item: Placed, side: TagSide): void {
  if (sideOf(item.element) === side) return;
  if (!setTagSide(item.element, side)) return;
  item.marker.setOffset?.(offsetFor(side, sizeOf(item.element)));
}

function sideOf(element: HTMLElement): TagSide {
  const side = element.dataset.tagSide;
  return TAG_SIDES.find((known) => known === side) ?? "above";
}

/**
 * Place every marker's tag clear of the stops and places drawn with it — or,
 * with `fixed`, put back above any tag a previous `avoid` had moved.
 */
export function placeTags(map: Pick<MapLike, "project">, items: readonly Placed[], bounds: Size, mode: "avoid" | "fixed" = "avoid"): void {
  const tags = items.filter((item) => item.role === "tag");
  if (mode === "fixed") {
    for (const item of tags) applySide(item, "above");
    return;
  }
  const obstacles = items.filter((item) => item.role !== "tag").map((item) => obstacleOf(map, item));
  for (const item of tags) {
    const pin = map.project(item.at);
    const under = underPin(pin, obstacles, !!item.standing);
    item.standing = under.length > 0;
    const blocking = obstacles.filter((obstacle) => !under.includes(obstacle));
    applySide(item, chooseSide(pin, sizeOf(item.element.firstElementChild), blocking, bounds, sideOf(item.element)));
  }
}
