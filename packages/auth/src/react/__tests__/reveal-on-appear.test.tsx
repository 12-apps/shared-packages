import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RevealOnAppear } from "../screens/shared";

/**
 * A refusal renders at the top of its form and the button that caused it sits
 * at the bottom — a screen apart on a phone. The wrapper brings it into view
 * when it appears off screen, and leaves the page alone when it is on screen.
 *
 * jsdom lays nothing out and has no `scrollIntoView`, so both are supplied
 * here: the rect says where the banner "is", the spy says whether the page was
 * asked to move.
 */
const scrollIntoView = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  scrollIntoView.mockReset();
  vi.restoreAllMocks();
});

function placeAt(top: number, height = 120): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("RevealOnAppear", () => {
  it("centres a refusal that appeared above the window", () => {
    placeAt(-300);
    render(<RevealOnAppear>Não foi possível criar a conta</RevealOnAppear>);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("centres a refusal that appeared below the window", () => {
    placeAt(100_000);
    render(<RevealOnAppear>Não foi possível entrar</RevealOnAppear>);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("leaves the page alone when the refusal is already on screen", () => {
    placeAt(100);
    render(<RevealOnAppear>Não foi possível entrar</RevealOnAppear>);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
