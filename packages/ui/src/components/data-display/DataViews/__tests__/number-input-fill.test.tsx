/**
 * `NumberBoundInput` can take the width of its cell (FUT-4144 UI review round
 * 2): in the "Mais" panel the Valor pair kept its fixed 140px while the panel
 * grew, leaving a ragged 66px gap at 390 beside boxes the day pair filled.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumberBoundInput } from "../data-views-number-input";

const root = (testId: string): HTMLElement => screen.getByTestId(testId).closest(".MuiFormControl-root") as HTMLElement;

describe("NumberBoundInput — fill", () => {
  it("keeps its own width by default", () => {
    render(<NumberBoundInput label="De" value={undefined} unit="R$" onChange={vi.fn()} testId="n" />);
    expect(root("n")).not.toHaveClass("MuiFormControl-fullWidth");
  });

  it("takes its cell's width when asked to fill", () => {
    render(<NumberBoundInput fill label="De" value={undefined} unit="R$" onChange={vi.fn()} testId="n" />);
    expect(root("n")).toHaveClass("MuiFormControl-fullWidth");
  });
});
