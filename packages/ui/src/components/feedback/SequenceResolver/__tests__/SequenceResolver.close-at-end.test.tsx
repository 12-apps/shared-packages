/**
 * `done: null` (FUT-3833): no end screen — when the queue runs out, whether
 * the last step was answered or passed over, the resolver calls
 * `onClose(summary)` once and the host's toast is the run's last word.
 */
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SequenceResolver } from "../SequenceResolver";
import type {
  SequenceItem,
  SequenceResolverLabels,
  SequenceResolverProps,
  SequenceStep,
  SequenceStepApi,
} from "../SequenceResolver.types";

interface Problem extends SequenceItem {
  name: string;
}

const P = (key: string): Problem => ({ key, kindLabel: "Purchase", name: `Item ${key}` });

const LABELS: SequenceResolverLabels = {
  back: "Back",
  close: "Close",
  skip: "Skip for now",
  step: (position, total) => `Problem ${position} of ${total}`,
  introStep: "Problems to solve",
  doneStep: "Done",
  progress: "Progress",
  failed: "Something went wrong",
};

type Props = SequenceResolverProps<Problem, string>;

function saveStep(item: Problem, api: SequenceStepApi<string>): SequenceStep {
  return {
    content: <h3 {...api.titleProps}>{item.name}</h3>,
    primary: { label: "Save", onClick: () => api.resolve(`saved ${item.key}`) },
  };
}

function renderResolver(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    queue: [P("a"), P("b")],
    renderStep: saveStep,
    done: null,
    labels: LABELS,
    dataTestId: "sr",
    ...overrides,
  };
  const view = render(<SequenceResolver {...props} />);
  const rerender = (next: Partial<Props>): void => view.rerender(<SequenceResolver {...props} {...next} />);
  return { props, rerender };
}

const click = (testId: string): void => {
  fireEvent.click(screen.getByTestId(testId));
};

afterEach(() => {
  cleanup();
});

describe("done: null", () => {
  it("closes with the summary when the last step is answered, and shows no end screen", async () => {
    const onClose = vi.fn();
    renderResolver({ onClose });
    click("sr-secondary");
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ resolved: 1, skipped: 1, total: 2, alsoResolved: 0 });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sr-done")).toBeNull();
  });

  it("closes as well when the last step is passed over, with nothing resolved", async () => {
    const onClose = vi.fn();
    renderResolver({ onClose, queue: [P("a")] });
    click("sr-secondary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ resolved: 0, skipped: 1, total: 1, alsoResolved: 0 });
    });
  });

  it("counts the siblings an answer resolved together", async () => {
    const onClose = vi.fn();
    renderResolver({
      onClose,
      queue: [P("a")],
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: { label: "Save", onClick: () => api.resolve("all", { alsoResolved: 2 }) },
      }),
    });
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ resolved: 1, skipped: 0, total: 1, alsoResolved: 2 });
    });
  });

  it("waits for the last write, and closes only once it returns", async () => {
    const onClose = vi.fn();
    const hands: { finish: (value: string) => void } = { finish: () => undefined };
    const write = new Promise<string>((done) => {
      hands.finish = done;
    });
    renderResolver({
      onClose,
      queue: [P("a")],
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: { label: "Save", onClick: () => api.resolve(write) },
      }),
    });
    click("sr-primary");
    await waitFor(() => expect(screen.getByTestId("sr-primary")).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      hands.finish("done");
      await write;
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the step, and does not close, when the last write is refused", async () => {
    const onClose = vi.fn();
    renderResolver({
      onClose,
      queue: [P("a")],
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: { label: "Save", onClick: () => api.resolve(Promise.reject(new Error("Out of sync"))) },
      }),
    });
    click("sr-primary");
    await waitFor(() => {
      expect(screen.getByTestId("sr-error")).toHaveTextContent("Out of sync");
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Item a");
  });

  it("closes when the host's queue empties under it (resolved elsewhere)", async () => {
    const onClose = vi.fn();
    const { rerender } = renderResolver({ onClose });
    rerender({ onClose, queue: [] });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ resolved: 0, skipped: 0, total: 0, alsoResolved: 0 });
    });
  });

  it("calls onClose once while the host has not closed it yet", async () => {
    const onClose = vi.fn();
    const { rerender } = renderResolver({ onClose, queue: [P("a")] });
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    rerender({ onClose, queue: [] });
    rerender({ onClose, queue: [] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never closes from the intro", () => {
    const onClose = vi.fn();
    renderResolver({
      onClose,
      queue: [],
      intro: { title: "Problems", categories: [], startAllLabel: "Start", onStartAll: () => undefined },
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("starts a fresh run when it opens again", async () => {
    const onClose = vi.fn();
    const { rerender } = renderResolver({ onClose, queue: [P("a")] });
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    rerender({ onClose, open: false, queue: [P("b")] });
    rerender({ onClose, open: true, queue: [P("b")] });
    expect(screen.getByTestId("sr-step-label")).toHaveTextContent("Problem 1 of 1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("plays its exit over the last step as it was: label, Back, progress and body do not change", async () => {
    const onClose = vi.fn();
    const { rerender } = renderResolver({ onClose });
    click("sr-secondary");
    const seen = () => ({
      label: screen.getByTestId("sr-step-label").textContent,
      back: screen.getByTestId("sr-back").textContent,
      progress: screen.getByTestId("sr-progress").outerHTML,
      body: screen.getByTestId("sr-body").textContent,
      height: screen.getByTestId("sr-body").childElementCount,
    });
    const before = seen();
    expect(before.label).toBe("Problem 2 of 2");
    expect(before.body).toContain("Item b");
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    // The closing render: the dialog is on its way out, still showing step 2.
    expect(seen()).toEqual(before);
    expect(screen.queryByText("Done")).toBeNull();
    // The host turns it off from onClose: still the same screen for the rest of the exit.
    rerender({ onClose, open: false });
    expect(seen()).toEqual(before);
    // Back is inert during the exit.
    click("sr-back");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose once under StrictMode when it mounts open over an empty queue", async () => {
    const onClose = vi.fn();
    render(
      <StrictMode>
        <SequenceResolver<Problem, string> open onClose={onClose} queue={[]} renderStep={saveStep} done={null} labels={LABELS} dataTestId="sr" />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 50));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose once under StrictMode when the last step is answered", async () => {
    const onClose = vi.fn();
    render(
      <StrictMode>
        <SequenceResolver<Problem, string> open onClose={onClose} queue={[P("a")]} renderStep={saveStep} done={null} labels={LABELS} dataTestId="sr" />
      </StrictMode>,
    );
    click("sr-primary");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 50));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
