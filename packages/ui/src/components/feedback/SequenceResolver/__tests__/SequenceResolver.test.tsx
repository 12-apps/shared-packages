/**
 * SequenceResolver driven through the DOM: the intro, each step's verbs, Back
 * (with and without the host's inverse), the async busy/error path, a queue
 * that shrinks mid-run, the end screen, closing, and the phone sheet.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SequenceResolver } from "../SequenceResolver";
import type {
  SequenceIntro,
  SequenceItem,
  SequenceResolverLabels,
  SequenceResolverProps,
  SequenceStep,
  SequenceStepApi,
} from "../SequenceResolver.types";

interface Problem extends SequenceItem {
  name: string;
}

const P = (key: string, kindLabel = "Purchase"): Problem => ({ key, kindLabel, name: `Item ${key}` });
const QUEUE = [P("a"), P("b"), P("c")];

const LABELS: SequenceResolverLabels = {
  back: "Back",
  backAccessible: "Back to the previous problem",
  close: "Close",
  skip: "Skip for now",
  step: (position, total, item) => `Problem ${position} of ${total} · ${item.kindLabel}`,
  introStep: "Problems to solve",
  doneStep: "Done",
  progress: "Progress",
  failed: "Something went wrong",
};

/** A step with the documented shape: the item's name as the title, a "Save" primary. */
function basicStep(item: Problem, api: SequenceStepApi<string>): SequenceStep {
  return {
    content: (
      <div>
        <h3 {...api.titleProps}>{item.name}</h3>
        <p>What happened?</p>
      </div>
    ),
    primary: { label: "Save", onClick: () => api.resolve(`saved ${item.key}`) },
  };
}

type Props = SequenceResolverProps<Problem, string>;

function renderResolver(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    queue: QUEUE,
    renderStep: basicStep,
    done: (summary) => ({
      title: summary.resolved === summary.total ? "All solved" : `${summary.resolved} of ${summary.total} solved`,
      description: "The ones you skipped stay in the list.",
      confirmLabel: "Finish",
    }),
    labels: LABELS,
    dataTestId: "sr",
    ...overrides,
  };
  const view = render(<SequenceResolver {...props} />);
  const rerender = (next: Partial<Props>): void => view.rerender(<SequenceResolver {...props} {...next} />);
  return { props, rerender };
}

const stepLabel = (): string => screen.getByTestId("sr-step-label").textContent ?? "";
const click = (testId: string): void => {
  fireEvent.click(screen.getByTestId(testId));
};
const dialog = (): HTMLElement => screen.getByRole("dialog");

/** What a browser does to a focused button that becomes disabled: focus falls to the page. */
function dropFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** A promise the test settles by hand: the host's server write or inverse, held open. */
function latch<T>(): { promise: Promise<T>; open: (value: T) => void } {
  const hands: { open: (value: T) => void } = { open: () => undefined };
  const promise = new Promise<T>((done) => {
    hands.open = done;
  });
  return { promise, open: (value) => hands.open(value) };
}

/** Answers `max-width` queries with `true` so `useMediaQuery` reports a phone. */
function stubPhoneViewport(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the intro", () => {
  const intro = (overrides: Partial<SequenceIntro> = {}): SequenceIntro => ({
    title: "14 problems to solve",
    description: "Solve them one at a time, or pick a kind.",
    categories: [
      { label: "No stock", description: "register the purchase", count: 2, onPick: vi.fn() },
      { label: "Unexplained losses", description: "say why they left", count: 5, onPick: vi.fn() },
    ],
    startAllLabel: "Solve all in sequence",
    onStartAll: vi.fn(),
    ...overrides,
  });

  it("names the dialog by its title, lists each kind with its count, and offers no Back", async () => {
    renderResolver({ intro: intro() });
    expect(dialog()).toHaveAccessibleName("14 problems to solve");
    expect(stepLabel()).toBe("Problems to solve");
    expect(screen.getByTestId("sr-category-0")).toHaveTextContent("2No stockregister the purchase");
    expect(screen.getByTestId("sr-category-1")).toHaveTextContent("5Unexplained losses");
    expect(screen.queryAllByTestId("sr-back")).toHaveLength(0);
    expect(screen.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("calls the kind's onPick, and onStartAll for the whole run", async () => {
    const value = intro();
    renderResolver({ intro: value });
    click("sr-category-1");
    await waitFor(() => {
      expect(value.categories[1]?.onPick).toHaveBeenCalledTimes(1);
    });
    click("sr-start-all");
    await waitFor(() => {
      expect(value.onStartAll).toHaveBeenCalledTimes(1);
    });
  });

  it("starts the run on the queue the host sets when it drops the intro", () => {
    const { rerender } = renderResolver({ intro: intro(), queue: [] });
    rerender({ intro: undefined, queue: [P("x", "Limits"), P("y")] });
    expect(stepLabel()).toBe("Problem 1 of 2 · Limits");
    expect(dialog()).toHaveAccessibleName("Item x");
  });
});

describe("a step", () => {
  it("shows the position and kind, the host's body, Skip and the primary — and no Back on the first", async () => {
    renderResolver();
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
    expect(dialog()).toHaveAccessibleName("Item a");
    expect(screen.getByTestId("sr-secondary")).toHaveTextContent("Skip for now");
    expect(screen.getByTestId("sr-primary")).toHaveTextContent("Save");
    expect(screen.queryAllByTestId("sr-back")).toHaveLength(0);
  });

  it("puts focus on the step title when it opens and on each advance", async () => {
    renderResolver();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Item a" })).toHaveFocus());
    click("sr-primary");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Item b" })).toHaveFocus());
  });

  it("resolve moves to the next step and offers Back, named for the reader", async () => {
    renderResolver();
    click("sr-primary");
    await waitFor(() => {
      expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
    });
    expect(screen.getByTestId("sr-back")).toHaveAccessibleName("Back to the previous problem");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  });

  it("skip moves on; Back over a skipped step calls no inverse", async () => {
    const onBack = vi.fn();
    renderResolver({ onBack });
    click("sr-secondary");
    await waitFor(() => {
      expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
    });
    click("sr-back");
    await waitFor(() => {
      expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("lets a step reword or drop the secondary and add one tertiary", async () => {
    const tertiary = vi.fn();
    const { rerender } = renderResolver({
      renderStep: (item, api) => ({
        ...basicStep(item, api),
        secondary: { label: "Not bought yet", onClick: api.skip },
        tertiary: { label: "It was a stock count", onClick: tertiary },
      }),
    });
    expect(screen.getByTestId("sr-secondary")).toHaveTextContent("Not bought yet");
    click("sr-tertiary");
    await waitFor(() => {
      expect(tertiary).toHaveBeenCalledTimes(1);
    });
    rerender({ renderStep: (item, api) => ({ ...basicStep(item, api), secondary: false }) });
    await waitFor(() => {
      expect(screen.queryByTestId("sr-secondary")).toBeNull();
    });
    expect(screen.getByTestId("sr-primary")).toBeInTheDocument();
  });

  it("hides Back when the host turns it off", async () => {
    renderResolver({ canGoBack: false });
    click("sr-primary");
    await waitFor(() => {
      expect(screen.queryByTestId("sr-back")).toBeNull();
    });
  });
});

describe("Back over a resolved step", () => {
  it("awaits the host's inverse with the item and its result, busy meanwhile, then shows that step", async () => {
    const { promise: undo, open: finish } = latch<void>();
    const onBack = vi.fn(() => undo);
    renderResolver({ onBack });
    click("sr-primary");
    click("sr-back");
    await waitFor(() => {
      expect(onBack).toHaveBeenCalledWith(QUEUE[0], "saved a");
    });
    await waitFor(() => expect(screen.getByTestId("sr-primary")).toBeDisabled());
    expect(screen.getByTestId("sr-back")).toBeDisabled();
    expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
    await act(async () => {
      finish(undefined);
      await undo;
    });
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
    expect(screen.getByTestId("sr-primary")).toBeEnabled();
  });

  it("keeps the current step and shows the host's message when the inverse rejects", async () => {
    const onBack = vi.fn(() => Promise.reject(new Error("Could not undo the purchase")));
    renderResolver({ onBack });
    click("sr-primary");
    click("sr-back");
    await waitFor(() => {
      expect(screen.getByTestId("sr-error")).toHaveTextContent("Could not undo the purchase");
    });
    expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
    expect(screen.getByTestId("sr-primary")).toBeEnabled();
    click("sr-secondary");
    await waitFor(() => expect(screen.queryByTestId("sr-error")).toBeNull());
  });

  it("falls back to labels.failed for a rejection with no message, and for a synchronous throw", async () => {
    const onBack = vi.fn(() => {
      throw undefined;
    });
    renderResolver({ onBack });
    click("sr-primary");
    click("sr-back");
    await waitFor(() => {
      expect(screen.getByTestId("sr-error")).toHaveTextContent("Something went wrong");
    });
  });
});

describe("resolve with a promise", () => {
  it("stays busy on the step until the write returns, then advances", async () => {
    const { promise: write, open: finish } = latch<string>();
    renderResolver({
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: { label: "Save", onClick: () => api.resolve(write) },
      }),
    });
    click("sr-primary");
    await waitFor(() => expect(screen.getByTestId("sr-primary")).toBeDisabled());
    expect(screen.getByTestId("sr-secondary")).toBeDisabled();
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
    await act(async () => {
      finish("done");
      await write;
    });
    expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
  });

  it("keeps focus in the dialog when the pressed button disables itself", async () => {
    const { promise: write } = latch<string>();
    renderResolver({
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: {
          label: "Save",
          onClick: () => {
            dropFocus();
            api.resolve(write);
          },
        },
      }),
    });
    click("sr-primary");
    await waitFor(() => {
      expect(dialog().querySelector('[aria-busy="true"]')).toHaveFocus();
    });
  });

  it("ignores a second answer while the first is pending", async () => {
    const write = new Promise<string>(() => undefined);
    const resolveSpy = vi.fn();
    renderResolver({
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: {
          label: "Save",
          onClick: () => {
            resolveSpy();
            api.resolve(write);
            api.resolve("second");
            api.skip();
          },
        },
      }),
    });
    click("sr-primary");
    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => expect(screen.getByTestId("sr-primary")).toBeDisabled());
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
  });

  it("keeps the step and shows the message when the write rejects", async () => {
    renderResolver({
      renderStep: (item, api) => ({
        content: <h3 {...api.titleProps}>{item.name}</h3>,
        primary: { label: "Save", onClick: () => api.resolve(Promise.reject(new Error("Out of sync"))) },
      }),
    });
    click("sr-primary");
    await waitFor(() => {
      expect(screen.getByTestId("sr-error")).toHaveTextContent("Out of sync");
    });
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
  });

  it("holds the step on screen when the host's refetch drops it before the write returns", async () => {
    const { promise: write, open: finish } = latch<string>();
    const renderStep = (item: Problem, api: SequenceStepApi<string>): SequenceStep => ({
      content: <h3 {...api.titleProps}>{item.name}</h3>,
      primary: { label: "Save", onClick: () => api.resolve(write) },
    });
    const { rerender } = renderResolver({ renderStep });
    click("sr-primary");
    rerender({ renderStep, queue: [P("b"), P("c")] });
    expect(dialog()).toHaveAccessibleName("Item a");
    await act(async () => {
      finish("done");
      await write;
    });
    expect(dialog()).toHaveAccessibleName("Item b");
    expect(stepLabel()).toBe("Problem 2 of 3 · Purchase");
  });
});

describe("a queue that shrinks mid-run", () => {
  it("drops the steps resolved together with this one, and the total follows", async () => {
    const queue = [P("a", "Limits"), P("b", "Limits"), P("c", "Limits"), P("d", "Purchase")];
    const { rerender } = renderResolver({ queue });
    click("sr-primary");
    rerender({ queue: [queue[0] as Problem, queue[3] as Problem] });
    expect(stepLabel()).toBe("Problem 2 of 2 · Purchase");
    expect(dialog()).toHaveAccessibleName("Item d");
  });
});

describe("the end screen", () => {
  it("shows the host's words for the summary and closes with it", async () => {
    const onClose = vi.fn();
    renderResolver({ onClose, queue: [P("a"), P("b")] });
    click("sr-primary");
    click("sr-secondary");
    await waitFor(() => {
      expect(stepLabel()).toBe("Done");
    });
    expect(dialog()).toHaveAccessibleName("1 of 2 solved");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByTestId("sr-back")).toBeInTheDocument();
    click("sr-done-confirm");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledWith({ resolved: 1, skipped: 1, total: 2 });
    });
  });

  it("takes a static `done` too", async () => {
    renderResolver({ queue: [P("a")], done: { title: "All solved", confirmLabel: "Finish" } });
    click("sr-primary");
    await waitFor(() => {
      expect(screen.getByTestId("sr-done")).toHaveTextContent("All solved");
    });
    expect(within(screen.getByTestId("sr-done")).getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("goes back from the end screen to the last step", async () => {
    renderResolver({ queue: [P("a")] });
    click("sr-secondary");
    click("sr-back");
    await waitFor(() => {
      expect(stepLabel()).toBe("Problem 1 of 1 · Purchase");
    });
  });
});

describe("closing", () => {
  it("the close button and Esc call onClose with where the run stood", async () => {
    const onClose = vi.fn();
    renderResolver({ onClose });
    click("sr-primary");
    click("sr-close");
    await waitFor(() => {
      expect(onClose).toHaveBeenLastCalledWith({ resolved: 1, skipped: 0, total: 3 });
    });
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("names the close button with the host's word", () => {
    renderResolver();
    expect(screen.getByTestId("sr-close")).toHaveAccessibleName("Close");
  });

  it("restarts the run when it opens again", () => {
    const { rerender } = renderResolver();
    click("sr-primary");
    rerender({ open: false });
    rerender({ open: true });
    expect(stepLabel()).toBe("Problem 1 of 3 · Purchase");
  });
});

describe("on a phone", () => {
  it("draws the sheet's decorative handle and keeps the same dialog semantics", () => {
    stubPhoneViewport();
    renderResolver();
    expect(screen.getByTestId("sr-handle")).toHaveAttribute("aria-hidden", "true");
    expect(dialog()).toHaveAccessibleName("Item a");
  });
});
