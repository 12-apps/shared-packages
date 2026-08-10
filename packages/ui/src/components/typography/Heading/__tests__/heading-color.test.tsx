/**
 * A GRADIENT HEADING DRAWS THE COLOUR IT WAS ASKED FOR.
 *
 * `GRADIENT_STOPS` was `Record<string, …>` with `?? PRIMARY_STOPS` behind it,
 * and it held five of the seven colours. So `<Heading gradient color="info">`
 * and `<Heading gradient color="neutral">` painted the PRIMARY gradient — the
 * heading looked deliberate, the prop was simply ignored, and no test said so
 * because every existing one reads the text.
 *
 * That is the same failure the whole vocabulary exists to prevent, one level
 * down: not a value the type rejects, but a value the type accepts and the
 * implementation quietly drops. The map is keyed over `ColorValue` now and the
 * fallback is gone, so a colour without stops is a compile error.
 *
 * These tests pin the behaviour rather than the map, so they would still fail if
 * someone reintroduced a fallback: every colour must paint something, and no
 * colour may paint the same thing as another.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Heading } from "../Heading";
import { COLOR_VALUES } from "../../../../tokens/scales";

/** The painted gradient, read off the element rather than off the source map. */
const backgroundOf = (color: (typeof COLOR_VALUES)[number]): string => {
  const { unmount } = render(
    <Heading level="h2" gradient color={color}>
      {color}
    </Heading>,
  );
  const painted = globalThis.getComputedStyle(screen.getByText(color)).background;
  unmount();
  return painted;
};

describe("Heading — the gradient honours every colour in the vocabulary", () => {
  it("paints a gradient for each of the seven, none of them empty", () => {
    for (const color of COLOR_VALUES) {
      expect(backgroundOf(color), `${color} painted no gradient`).toContain("linear-gradient");
    }
  });

  it("gives each colour its OWN gradient — `info` and `neutral` fell back to primary", () => {
    // The two that were missing from the map, named explicitly: this is the
    // regression, and a bare uniqueness check would not say which colour broke.
    expect(backgroundOf("info")).not.toBe(backgroundOf("primary"));
    expect(backgroundOf("neutral")).not.toBe(backgroundOf("primary"));

    const gradients = COLOR_VALUES.map(backgroundOf);
    expect(new Set(gradients).size).toBe(COLOR_VALUES.length);
  });
});
