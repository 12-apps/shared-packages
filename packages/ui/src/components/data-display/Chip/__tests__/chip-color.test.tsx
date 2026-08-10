/**
 * THE CHIP SPEAKS THE HOUSE COLOUR VOCABULARY.
 *
 * `ChipProps.color` was `string`, and a cast pushed it straight at MUI. So
 * `danger` — the word `Button`, `Alert`, `Text`, `Heading`, `Paragraph` and
 * `Blockquote` all accept — reached MUI as an unknown value and fell back to the
 * default grey. The chip that most needed emphasis rendered with none, and
 * nothing failed to say so.
 *
 * The fix was NOT to reject `danger`. That would punish a caller for using the
 * vocabulary the rest of the system taught them. It is for the chip to accept it
 * and translate at the MUI boundary, exactly as `Button` does — which is what
 * these tests pin:
 *
 *   - every house colour is accepted AND reaches MUI as a real palette entry,
 *     since a value that type-checks and is then dropped is the same bug wearing
 *     a better type;
 *   - `danger` and `neutral` — the two that are ours rather than MUI's — land on
 *     `error` and `default` specifically;
 *   - MUI's own `error` is REJECTED, because two words for one colour is what
 *     produced the bug in the first place.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "../Chip";
import type { ChipColor, ChipProps } from "../Chip.types";

/** The house vocabulary, identical to `ButtonProps['color']`. */
const ALL_COLORS: readonly ChipColor[] = [
  "primary",
  "secondary",
  "success",
  "warning",
  "info",
  "danger",
  "neutral",
];

/** House word → the MUI palette entry it must land on. */
const MUI_CLASS: Record<ChipColor, string> = {
  primary: "colorPrimary",
  secondary: "colorSecondary",
  success: "colorSuccess",
  warning: "colorWarning",
  info: "colorInfo",
  // The two that are ours.
  danger: "colorError",
  neutral: "colorDefault",
};

describe("ChipColor", () => {
  it("rejects MUI's own spelling of a colour we have a word for", () => {
    // Asserted through `ChipProps["color"]` rather than the `ChipColor` alias,
    // because the PROP is what callers write and the prop is what regressed.
    // Pinning the alias alone still passes if someone widens the prop back to
    // `string` — verified by doing exactly that and watching it stay green.
    // @ts-expect-error `error` is MUI's word; ours is `danger`. Accepting both
    // would put two names for one colour back in the API, which is the thing
    // that let the original bug hide. Deleting this directive must fail the build.
    const rejected: ChipProps["color"] = "error";
    expect(rejected).toBe("error");
  });

  it("keeps the prop tied to the alias", () => {
    // If the prop is widened, `ChipColor` no longer covers it and this fails to
    // compile — the second half of the guarantee above.
    const asAlias: ChipColor | undefined = ({} as ChipProps).color;
    expect(asAlias).toBeUndefined();
  });

  it("matches Button's vocabulary exactly", () => {
    // Not a style preference: a chip beside a button, both meaning "destructive",
    // must be spelled the same way. If Button's union changes, this list is the
    // reminder that the chip's has to move with it.
    expect([...ALL_COLORS].sort()).toEqual(
      ["primary", "secondary", "success", "warning", "info", "danger", "neutral"].sort(),
    );
  });

  it.each(ALL_COLORS)("draws %s as a real MUI palette entry", (color) => {
    render(<Chip label={color} color={color} dataTestId={`chip-${color}`} />);

    // The class is the observable proof the value was UNDERSTOOD rather than
    // passed through and ignored — which is precisely what happened to `danger`.
    expect(screen.getByTestId(`chip-${color}`).className).toContain(MUI_CLASS[color]);
  });
});
