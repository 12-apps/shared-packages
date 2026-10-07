/**
 * The DOM each MapLibre marker carries. MapLibre positions plain elements, so
 * these are built directly — real `<button>`s with accessible names where the
 * viewer can act, an `img` role with a title where they only read.
 */

import type { RouteMapCopy } from "./copy";
import type { RouteMapMarker, RouteMapPlace, RouteMapStop, RouteMapTheme } from "./types";

const SHADOW = "0 2px 6px rgba(0,0,0,.25)";

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

export function markerElement(marker: RouteMapMarker, theme: RouteMapTheme): HTMLElement {
  const frame = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" };
  const element = button(
    marker.ariaLabel,
    { ...frame, background: "none", border: "0", padding: "0", minWidth: "44px", minHeight: "44px", zIndex: marker.emphasized ? "3" : "2" },
    marker.onSelect,
  );
  if (marker.emphasized) element.setAttribute("aria-pressed", "true");
  const bubble = span(marker.text, {
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
  const tail = span("", { width: "0", height: "0", borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: `9px solid ${marker.color}` });
  element.append(bubble, tail);
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
  const tail = span("", { width: "0", height: "0", borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: `9px solid ${theme.ink}` });
  element.append(bubble, tail);
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
  });
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", stop.title);
  element.title = stop.title;
  return element;
}

export function placeElement(spot: RouteMapPlace, theme: RouteMapTheme): HTMLElement {
  return span(spot.label, { background: theme.place, color: theme.paper, padding: "4px 10px", borderRadius: "10px", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" });
}
