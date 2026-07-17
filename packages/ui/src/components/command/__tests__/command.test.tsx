import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Command } from "../../form/Command/Command";
import type { CommandItem } from "../../form/Command/Command.types";

const items: CommandItem[] = [
  { id: "new-file", label: "New File", category: "File" },
  { id: "open-file", label: "Open File", category: "File" },
  { id: "settings", label: "Settings", category: "Preferences" },
];

function renderCommand(props: Partial<React.ComponentProps<typeof Command>> = {}) {
  return render(
    <Command
      open
      items={items}
      autoFocus={false}
      dataTestId="command"
      {...props}
    />,
  );
}

describe("Command (REUSE — form/Command primitive)", () => {
  it("renders items grouped into sections via category when showCategories is on", () => {
    renderCommand({ showCategories: true });

    // Category headings rendered as group containers.
    expect(screen.getByTestId("command-group-File")).toBeInTheDocument();
    expect(screen.getByTestId("command-group-Preferences")).toBeInTheDocument();

    // All items present.
    expect(screen.getByTestId("command-item-new-file")).toBeInTheDocument();
    expect(screen.getByTestId("command-item-open-file")).toBeInTheDocument();
    expect(screen.getByTestId("command-item-settings")).toBeInTheDocument();

    // The File group contains both file items.
    const fileGroup = screen.getByTestId("command-group-File");
    expect(fileGroup).toHaveTextContent("New File");
    expect(fileGroup).toHaveTextContent("Open File");
  });

  it("moves the visible highlight down with ArrowDown", () => {
    renderCommand();
    const input = screen.getByTestId("command-input");

    // First item highlighted by default.
    expect(screen.getByTestId("command-item-new-file")).toHaveClass(
      "Mui-selected",
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Highlight advances to the second item.
    expect(screen.getByTestId("command-item-open-file")).toHaveClass(
      "Mui-selected",
    );
    expect(screen.getByTestId("command-item-new-file")).not.toHaveClass(
      "Mui-selected",
    );
  });

  it("moves the visible highlight up with ArrowUp", () => {
    renderCommand();
    const input = screen.getByTestId("command-input");

    // Move down twice, then up once → land on the second item.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(screen.getByTestId("command-item-open-file")).toHaveClass(
      "Mui-selected",
    );
    expect(screen.getByTestId("command-item-settings")).not.toHaveClass(
      "Mui-selected",
    );
  });

  it("calls onSelect with the highlighted item on Enter", () => {
    const onSelect = vi.fn();
    renderCommand({ onSelect, closeOnSelect: false });
    const input = screen.getByTestId("command-input");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "open-file" }),
    );
  });

  it("calls onOpenChange(false) on Escape", () => {
    const onOpenChange = vi.fn();
    renderCommand({ onOpenChange });
    const input = screen.getByTestId("command-input");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the empty message when there are no items", () => {
    renderCommand({ items: [], emptyMessage: "Nothing here" });

    expect(screen.getByTestId("command-empty")).toHaveTextContent(
      "Nothing here",
    );
  });
});
