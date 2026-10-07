/**
 * The DOM each MapLibre marker carries. MapLibre positions plain elements, so
 * these are built directly — real `<button>`s with accessible names where the
 * viewer can act, an `img` role with a title where they only read.
 */

import type { RouteMapCopy } from "./copy";
import type { RouteMapMarker, RouteMapPlace, RouteMapStop, RouteMapTheme } from "./types";

const SHADOW = "0 2px 6px rgba(0,0,0,.25)";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Stroke glyphs, drawn in the element's own colour (no remote asset). */
const GLYPHS = {
  motorbike: ["M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M15 6h3l3 6", "M5.5 17.5L9 10h6l3.5 7.5"],
  store: ["M3 9l1-5h16l1 5", "M4 9v11h16V9", "M9 20v-6h6v6"],
} as const;

function glyph(name: keyof typeof GLYPHS): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({ width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(key, value);
  }
  for (const d of GLYPHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function button(ariaLabel: string, style: Partial<CSSStyleDeclaration>, onClick?: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("aria-label", ariaLabel);
  Object.assign(element.style, { cursor: onClick ? "pointer" : "default", font: "inherit" }, style);
  if (onClick) {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }
  return element;
}

function span(text: string, style: Partial<CSSStyleDeclaration>): HTMLSpanElement {
  const element = document.createElement("span");
  element.textContent = text;
  Object.assign(element.style, style);
  return element;
}

/** Which side of its pin a marker's tag (pill and tail) is drawn on. */
export type TagSide = "above" | "below" | "right" | "left";

/** How far the tail reaches from the pill to the pin. */
export const TAG_TAIL_PX = 9;

/** Each tail's colour, so a side change can redraw it pointing elsewhere. */
const tailColours = new WeakMap<HTMLElement, string>();

/** The tail under a pill, pointing down at the pin (the `above` side). */
function tailElement(colour: string): HTMLElement {
  const tail = span("", { width: "0", height: "0", borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: `${TAG_TAIL_PX}px solid ${colour}` });
  tailColours.set(tail, colour);
  return tail;
}

/**
 * Per side: how the frame stacks pill and tail (the tail always at the edge
 * that meets the pin), and which tail border is filled (the triangle points
 * the opposite way) versus transparent (its two flanks).
 */
const SIDE_LAYOUT: Record<TagSide, { flexDirection: string; filled: Edge; flanks: readonly Edge[] }> = {
  above: { flexDirection: "column", filled: "top", flanks: ["left", "right"] },
  below: { flexDirection: "column-reverse", filled: "bottom", flanks: ["left", "right"] },
  right: { flexDirection: "row-reverse", filled: "right", flanks: ["top", "bottom"] },
  left: { flexDirection: "row", filled: "left", flanks: ["top", "bottom"] },
};

type Edge = "top" | "bottom" | "left" | "right";

function tailBorder(edge: Edge, side: TagSide, colour: string): string {
  const layout = SIDE_LAYOUT[side];
  if (edge === layout.filled) return `${TAG_TAIL_PX}px solid ${colour}`;
  return layout.flanks.includes(edge) ? "7px solid transparent" : "0";
}

/**
 * Lay a marker's (or group's) tag out on `side` of its pin, in place — the
 * element is never rebuilt, so keyboard focus survives. The caller re-offsets
 * the MapLibre marker so the tail's tip stays on the point. `false` when the
 * element is not a tag this module built (nothing changed).
 */
export function setTagSide(element: HTMLElement, side: TagSide): boolean {
  const tail = element.children[1] as HTMLElement | undefined;
  const colour = tail ? tailColours.get(tail) : undefined;
  if (!tail || colour === undefined) return false;
  element.style.flexDirection = SIDE_LAYOUT[side].flexDirection;
  for (const edge of ["top", "bottom", "left", "right"] as const) tail.style.setProperty(`border-${edge}`, tailBorder(edge, side, colour));
  element.dataset.tagSide = side;
  return true;
}

/**
 * A marker the viewer can act on is a `<button>` with `aria-pressed` (it
 * selects); one they can only read is an `img` with a label — never an empty
 * tab stop that does nothing.
 */
export function markerElement(marker: RouteMapMarker, theme: RouteMapTheme, onSelect: (() => void) | null): HTMLElement {
  const frame = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", minWidth: "44px", minHeight: "44px", zIndex: marker.emphasized ? "3" : "2" };
  let element: HTMLElement;
  if (onSelect) {
    element = button(marker.ariaLabel, { ...frame, background: "none", border: "0", padding: "0" }, onSelect);
    element.setAttribute("aria-pressed", marker.emphasized ? "true" : "false");
  } else {
    element = span("", frame);
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", marker.ariaLabel);
  }
  const bubble = span("", {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: marker.emphasized ? "6px 12px" : "5px 9px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: "700",
    whiteSpace: "nowrap",
    color: theme.paper,
    background: marker.color,
    border: `2px ${marker.faded ? "dashed" : "solid"} ${theme.paper}`,
    boxShadow: SHADOW,
    opacity: marker.faded ? "0.75" : "1",
  });
  if (marker.icon) bubble.appendChild(glyph(marker.icon));
  bubble.appendChild(document.createTextNode(marker.text));
  element.append(bubble, tailElement(marker.color));
  element.dataset.tagSide = "above";
  return element;
}

/**
 * A group of overlapping markers keeps the MARKER's shape (a pill with a
 * tail), so it never reads as a numbered stop badge drawn nearby.
 */
export function groupElement(count: number, copy: RouteMapCopy, theme: RouteMapTheme, onClick: () => void): HTMLElement {
  const frame = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" };
  const element = button(copy.group(count), { ...frame, background: "none", border: "0", padding: "0", minWidth: "44px", minHeight: "44px" }, onClick);
  const bubble = span(`+${count}`, {
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: "700",
    color: theme.paper,
    background: theme.ink,
    border: `2px solid ${theme.paper}`,
    boxShadow: SHADOW,
  });
  element.append(bubble, tailElement(theme.ink));
  element.dataset.tagSide = "above";
  return element;
}

export function stopElement(stop: RouteMapStop, theme: RouteMapTheme): HTMLElement {
  const fill = { done: theme.done, next: theme.next, pending: theme.pending }[stop.variant];
  const element = span(stop.mark, {
    width: "28px",
    height: "28px",
    boxSizing: "border-box",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: "700",
    background: fill,
    color: stop.variant === "pending" ? theme.ink : theme.paper,
    border: `2px solid ${stop.variant === "done" ? theme.paper : theme.ink}`,
    boxShadow: SHADOW,
    // Pins are z 2–3; an emphasised stop sits above them, the rest beneath.
    zIndex: stop.emphasized ? "4" : "1",
  });
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", stop.title);
  element.title = stop.title;
  return element;
}

/** How far above its point a place's label sits: label (~26) + stem (46) + dot (8). */
export const PLACE_LIFT = 80;

export function placeElement(spot: RouteMapPlace, theme: RouteMapTheme, lifted = true): HTMLElement {
  // The label rides ABOVE a pin-high stem, so a courier standing at the place
  // (a pin anchored on the same point) never covers it. It stays UNDER the
  // pins (z 1 against their 2–3), so the stem never crosses a pin's name, and
  // under any host overlay; clicks pass through to whatever is beneath.
  const element = span("", { display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none", zIndex: "1" });
  const label = span("", { display: "inline-flex", alignItems: "center", gap: "6px", background: theme.place, color: theme.paper, padding: "4px 10px", borderRadius: "10px", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" });
  if (spot.icon) label.appendChild(glyph(spot.icon));
  label.appendChild(document.createTextNode(spot.label));
  if (!lifted) {
    element.append(label);
    return element;
  }
  element.append(label, span("", { width: "2px", height: "46px", background: theme.place }), span("", { width: "8px", height: "8px", borderRadius: "50%", background: theme.place }));
  return element;
}
