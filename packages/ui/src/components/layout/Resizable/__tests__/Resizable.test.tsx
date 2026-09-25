import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider, createTheme } from "../../../../mui/styles";
import { remPx } from "../../../../tokens/relative";
import { Resizable } from "../Resizable";

// `fontSize: 12` scales every design px by 12/14 — the density a compact host sets.
const theme = createTheme({ typography: { fontSize: 12 } });

function renderBox(props: Partial<React.ComponentProps<typeof Resizable>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <Resizable data-testid="box" variant="horizontal" {...props}>
        <div>content</div>
      </Resizable>
    </ThemeProvider>,
  );
}

/** Drag the right handle `dx` pointer pixels. */
function dragRight(dx: number) {
  fireEvent.mouseDown(screen.getByTestId("box-handle-right"), { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(document, { clientX: dx, clientY: 0 });
  fireEvent.mouseUp(document);
}

describe("Resizable under a non-default type scale", () => {
  it("starts at the consumer's design px, drawn through the type scale", () => {
    renderBox({ width: 300, height: 120 });
    const box = screen.getByTestId("box");
    expect(getComputedStyle(box).width).toBe(`${remPx(theme, 300)}px`);
    expect(getComputedStyle(box).height).toBe(`${remPx(theme, 120)}px`);
  });

  it("follows the pointer in px and reports design px, the unit width takes", () => {
    const onResize = vi.fn();
    renderBox({ width: 300, height: 120, onResize });
    dragRight(24);
    const livePx = remPx(theme, 300) + 24;
    expect(getComputedStyle(screen.getByTestId("box")).width).toBe(`${livePx}px`);
    const [width, height] = onResize.mock.calls.at(-1) ?? [];
    expect(width).toBeCloseTo(livePx / remPx(theme, 1), 6);
    expect(height).toBeCloseTo(120, 6);
  });

  it("clamps at the design-px bounds through the same scale", () => {
    renderBox({ width: 300, maxWidth: 400 });
    dragRight(5000);
    expect(getComputedStyle(screen.getByTestId("box")).width).toBe(`${remPx(theme, 400)}px`);
  });

  it("draws the handle through the type scale", () => {
    renderBox();
    expect(getComputedStyle(screen.getByTestId("box-handle-right")).width).toBe(
      theme.typography.pxToRem(4),
    );
  });
});
