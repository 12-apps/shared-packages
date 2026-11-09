import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StepCardList } from "./StepCardList";
import type { StepCardItem } from "./StepCardList.types";

const reveal = vi.hoisted(() => ({ followBlock: vi.fn(() => vi.fn()) }));
vi.mock("../../../utils/reveal-block", async (original) => ({
  ...(await original<typeof import("../../../utils/reveal-block")>()),
  followBlock: reveal.followBlock,
}));

function items(overrides: Partial<Record<string, Partial<StepCardItem>>> = {}): StepCardItem[] {
  const base: StepCardItem[] = [
    { id: "kind", title: "What it is", state: "done", answer: "Flour", detail: "Dry goods", onChange: vi.fn(), changeLabel: "Edit" },
    { id: "amount", title: "How much", state: "current", children: <input aria-label="amount" /> },
    { id: "price", title: "Price", state: "todo" },
  ];
  return base.map((item) => ({ ...item, ...overrides[item.id] }));
}

beforeEach(() => reveal.followBlock.mockClear());
afterEach(() => vi.restoreAllMocks());

describe("StepCardList states", () => {
  it("is an ordered list with one item per step, each tagged with its state", () => {
    render(<StepCardList items={items()} />);
    const list = screen.getByTestId("step-card-list");
    expect(list.tagName).toBe("OL");
    const states = [...list.querySelectorAll(":scope > li")].map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["done", "current", "todo"]);
  });

  it("marks only the current item with aria-current=step", () => {
    render(<StepCardList items={items()} />);
    const marked = screen.getByTestId("step-card-list").querySelectorAll('[aria-current="step"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(screen.getByTestId("step-card-list-amount"));
  });

  it("draws the face on the current card only", async () => {
    render(
      <StepCardList
        items={items({ kind: { children: <p>done face</p> }, price: { children: <p>todo face</p> } })}
      />,
    );
    expect(screen.getByLabelText("amount")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("todo face")).toBeNull());
    // A done card does not draw a face either.
    await waitFor(() => expect(screen.queryByText("done face")).toBeNull());
  });

  it("names the current step with a heading and a todo step with its title", () => {
    render(<StepCardList items={items()} />);
    expect(screen.getByRole("heading", { level: 2, name: "How much" })).toBeInTheDocument();
    expect(screen.getByText("Price")).toBeInTheDocument();
  });

  it("takes the heading level from the caller", () => {
    render(<StepCardList items={items()} headingLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "How much" })).toBeInTheDocument();
  });
});

describe("the done card", () => {
  it("is ONE type=button holding the caption, the bold answer, the muted line and the change word", () => {
    const list = items();
    render(<StepCardList items={list} />);
    const button = screen.getByTestId("step-card-list-kind-change");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("1 · What it is");
    expect(button).toHaveTextContent("Flour");
    expect(button).toHaveTextContent("Dry goods");
    expect(button).toHaveTextContent("Edit");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button);
    expect(list[0]?.onChange).toHaveBeenCalledTimes(1);
  });

  it("uses the caller's caption instead of the default", () => {
    render(<StepCardList items={items({ kind: { caption: "Step one" } })} />);
    expect(screen.getByTestId("step-card-list-kind-change")).toHaveTextContent("Step one");
    expect(screen.getByTestId("step-card-list-kind-change")).not.toHaveTextContent("1 · What it is");
  });

  it("has no default copy: without a changeLabel no change word is drawn", async () => {
    render(<StepCardList items={items({ kind: { changeLabel: undefined } })} />);
    await waitFor(() => expect(screen.queryByTestId("step-card-list-kind-change-label")).toBeNull());
    expect(screen.getByTestId("step-card-list-kind-change")).not.toHaveTextContent(/Alterar|Change|Edit/);
  });

  it("takes the accessible name from changeAriaLabel when given", () => {
    render(<StepCardList items={items({ kind: { changeAriaLabel: "Edit what it is" } })} />);
    expect(screen.getByRole("button", { name: "Edit what it is" })).toBeInTheDocument();
  });

  it("is plain content, not a button, without onChange", async () => {
    render(<StepCardList items={items({ kind: { onChange: undefined } })} />);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(screen.getByTestId("step-card-list-kind")).toHaveTextContent("Flour");
  });
});

describe("done with error", () => {
  it("shows the error text and describes the button with it", () => {
    render(<StepCardList items={items({ kind: { state: "error", error: "Pick a kind" } })} />);
    const button = screen.getByTestId("step-card-list-kind-change");
    expect(screen.getByTestId("step-card-list-kind")).toHaveAttribute("data-state", "error");
    expect(button).toHaveAccessibleDescription("Pick a kind");
    expect(screen.getByTestId("step-card-list-kind-error")).toHaveTextContent("Pick a kind");
    // Still the one button that reopens the step.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no description when there is no error text", () => {
    render(<StepCardList items={items({ kind: { state: "error" } })} />);
    expect(screen.getByTestId("step-card-list-kind-change")).not.toHaveAttribute("aria-describedby");
  });
});

describe("heading focus and reveal on arrival", () => {
  it("leaves focus alone on the first draw", async () => {
    render(<StepCardList items={items()} />);
    await waitFor(() => expect(document.body).toHaveFocus());
    expect(reveal.followBlock).not.toHaveBeenCalled();
  });

  it("focuses the first current heading on mount when focusOnMount is set", async () => {
    render(<StepCardList items={items()} focusOnMount />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "How much" })).toHaveFocus());
    expect(reveal.followBlock).toHaveBeenCalledTimes(1);
  });

  it("focuses the new current heading and reveals it when the step changes", async () => {
    const { rerender } = render(<StepCardList items={items()} reveal={{ bottomInset: 80 }} />);
    rerender(
      <StepCardList
        items={items({ amount: { state: "done", answer: "2 kg" }, price: { state: "current" } })}
        reveal={{ bottomInset: 80 }}
      />,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Price" })).toHaveFocus());
    expect(reveal.followBlock).toHaveBeenCalledTimes(1);
    expect(reveal.followBlock).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ bottomInset: 80 }));
  });

  it("does not steal focus again on an unrelated re-render", async () => {
    const { rerender } = render(<StepCardList items={items()} />);
    rerender(
      <StepCardList items={items({ amount: { state: "done" }, price: { state: "current" } })} />,
    );
    // The visitor moves on from the heading; a plain re-render must not pull focus back.
    const heading = screen.getByRole("heading", { name: "Price" });
    await act(async () => {
      await heading.blur();
    });
    rerender(
      <StepCardList items={items({ amount: { state: "done" }, price: { state: "current" } })} />,
    );
    await waitFor(() => expect(document.body).toHaveFocus());
    expect(reveal.followBlock).toHaveBeenCalledTimes(1);
  });

  it("focuses but does not scroll when reveal is false", async () => {
    const { rerender } = render(<StepCardList items={items()} reveal={false} />);
    rerender(
      <StepCardList items={items({ amount: { state: "done" }, price: { state: "current" } })} reveal={false} />,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Price" })).toHaveFocus());
    expect(reveal.followBlock).not.toHaveBeenCalled();
  });

  it("reopens a done step: Change makes it current and focuses its heading", async () => {
    const { rerender } = render(<StepCardList items={items()} />);
    rerender(
      <StepCardList items={items({ kind: { state: "current" }, amount: { state: "todo" } })} />,
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "What it is" })).toHaveFocus());
  });
});
