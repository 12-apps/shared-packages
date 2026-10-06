/**
 * A soft chip is a status chip: the colour's tint for a ground, its dark step
 * for ink. It reaches MUI as `filled` (MUI has no third variant), never as an
 * unknown variant MUI would drop.
 */
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";

import { Chip } from "../Chip";

const theme = createTheme();

function soft(color: "danger" | "neutral"): HTMLElement {
  render(
    <ThemeProvider theme={theme}>
      <Chip label="Cancelado" variant="soft" color={color} dataTestId={`chip-${color}`} />
    </ThemeProvider>,
  );
  return screen.getByTestId(`chip-${color}`);
}

describe("Chip variant soft", () => {
  it("paints the colour's tint with its dark ink", () => {
    const chip = soft("danger");
    expect(chip.className).toContain("MuiChip-filled");
    const style = getComputedStyle(chip);
    expect(style.color).toBe("rgb(198, 40, 40)"); // error.dark
    expect(style.backgroundColor).toBe("rgba(211, 47, 47, 0.14)"); // error.main at the soft alpha
  });

  it("gives a neutral soft chip the selected ground and the secondary ink", () => {
    const style = getComputedStyle(soft("neutral"));
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0.08)"); // action.selected
    expect(style.color).toBe("rgba(0, 0, 0, 0.6)"); // text.secondary
  });
});
