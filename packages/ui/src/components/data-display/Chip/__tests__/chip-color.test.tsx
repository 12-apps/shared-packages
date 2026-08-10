/**
 * The chip's colour is a CLOSED set, and this is the test that keeps it closed.
 *
 * It was `string`. `danger` — a real colour in the super-admin design system and
 * the obvious guess for "money is owed" — type-checked, reached MUI as an
 * unknown value, and fell back to the default grey. The chip that most needed
 * emphasis rendered with none, and nothing failed to say so.
 *
 * Two halves, because the type alone is not the whole guarantee:
 *
 *   - the TYPE half is `@ts-expect-error`, which fails the build if `danger`
 *     ever becomes assignable again — that is, if someone restores the `as
 *     MuiChipColor` cast or widens the prop back to `string`;
 *   - the RENDER half proves the seven are not merely accepted but actually
 *     reach MUI, since a colour that type-checks and then gets dropped on the
 *     floor would be the same bug wearing a better type.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "../Chip";
import type { ChipColor, ChipProps } from "../Chip.types";

const ALL_COLORS: readonly ChipColor[] = [
  "primary",
  "secondary",
  "error",
  "info",
  "success",
  "warning",
  "default",
];

describe("ChipColor", () => {
  it("rejects a colour outside the set", () => {
    // Asserted through `ChipProps["color"]` rather than `ChipColor`, because the
    // PROP is what callers actually write and the prop is what regressed. Pinning
    // the alias alone would still pass if someone widened the prop back to
    // `string` — verified by doing exactly that and watching this stay green.
    // @ts-expect-error `danger` is not a chip colour — `error` is the
    // destructive one. Deleting this directive must fail the build.
    const rejected: ChipProps["color"] = "danger";
    expect(rejected).toBe("danger");
  });

  it("keeps the prop tied to the alias", () => {
    // If the prop is widened, `ChipColor` no longer covers it and this fails to
    // compile — the second half of the guarantee above.
    const asAlias: ChipColor | undefined = ({} as ChipProps).color;
    expect(asAlias).toBeUndefined();
  });

  it.each(ALL_COLORS)("renders %s as a MUI colour class", (color) => {
    render(<Chip label={color} color={color} dataTestId={`chip-${color}`} />);

    const chip = screen.getByTestId(`chip-${color}`);
    // MUI emits `MuiChip-colorPrimary`, `MuiChip-colorError`, … — the class is
    // the observable proof the value was understood rather than ignored.
    const suffix = color.charAt(0).toUpperCase() + color.slice(1);
    expect(chip.className).toContain(`color${suffix}`);
  });
});
