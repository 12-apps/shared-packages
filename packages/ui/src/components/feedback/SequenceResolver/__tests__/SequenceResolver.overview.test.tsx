/**
 * "Ver todos (N)" inside the run (FUT-3825): the header button, the overview,
 * a pick that jumps to the kind's first unanswered problem, "continue" back to
 * the step it left, Back after a jump, `initialKey`, and a step whose answer
 * has no inverse (`canGoBack: false`).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SequenceResolver } from "../SequenceResolver";
import type {
  SequenceItem,
  SequenceOverview,
  SequenceResolverLabels,
  SequenceResolverProps,
  SequenceStep,
  SequenceStepApi,
} from "../SequenceResolver.types";

interface Problem extends SequenceItem {
  name: string;
}

const P = (key: string, kindLabel: string): Problem => ({ key, kindLabel, name: `Pessoa ${key}` });
const LATE_A = P("late-a", "Atrasado");
const LATE_B = P("late-b", "Atrasado");
const AWAY = P("away", "Avisou que não vai");
const QUEUE = [LATE_A, AWAY, LATE_B];

const LABELS: SequenceResolverLabels = {
  back: "Voltar",
  close: "Fechar",
  skip: "Depois",
  step: (position, total) => `${position} de ${total}`,
  introStep: "Problemas",
  doneStep: "Pronto",
  progress: "Progresso",
  failed: "Não deu certo",
};

const overview = (onPick = vi.fn()): SequenceOverview => ({
  label: (total) => `Ver todos (${total})`,
  title: "3 problemas a resolver",
  categories: [
    { label: "Atrasado · 2", description: "Pessoa late-a, Pessoa late-b", count: 2, keys: ["late-a", "late-b"] },
    { label: "Avisou que não vai · 1", description: "Pessoa away", count: 1, keys: ["away"], onPick },
  ],
  pickLabel: "Resolver",
  continueLabel: "Continuar em sequência",
});

function step(item: Problem, api: SequenceStepApi<string>, extra: Partial<SequenceStep> = {}): SequenceStep {
  return {
    content: <h3 {...api.titleProps}>{item.name}</h3>,
    primary: { label: "Resolver agora", onClick: () => api.resolve(`ok ${item.key}`) },
    ...extra,
  };
}

type Props = SequenceResolverProps<Problem, string>;

function renderResolver(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    queue: QUEUE,
    renderStep: (item, api) => step(item, api),
    done: { title: "Tudo resolvido", confirmLabel: "Fechar" },
    labels: LABELS,
    overview: overview(),
    dataTestId: "sr",
    ...overrides,
  };
  const view = render(<SequenceResolver {...props} />);
  const rerender = (next: Partial<Props>): void => view.rerender(<SequenceResolver {...props} {...next} />);
  return { props, rerender };
}

const title = (): string => screen.getByRole("heading", { level: 3 }).textContent ?? "";
const stepLabel = (): string => screen.getByTestId("sr-step-label").textContent ?? "";
const press = (name: string | RegExp): void => {
  fireEvent.click(screen.getByRole("button", { name }));
};

afterEach(cleanup);

describe("the header's Ver todos", () => {
  it("shows with the run's total beside the step label, and no Back on the first step", async () => {
    renderResolver();
    expect(screen.getByTestId("sr-see-all")).toHaveTextContent("Ver todos (3)");
    expect(stepLabel()).toBe("1 de 3");
    await waitFor(() => expect(screen.queryByTestId("sr-back")).toBeNull());
  });

  it("is absent without an overview, and with a single problem", async () => {
    const { rerender } = renderResolver({ overview: undefined });
    await waitFor(() => expect(screen.queryByTestId("sr-see-all")).toBeNull());
    rerender({ overview: overview(), queue: [LATE_A] });
    await waitFor(() => expect(screen.queryByTestId("sr-see-all")).toBeNull());
  });

  it("is absent on the end screen", async () => {
    renderResolver({ queue: [LATE_A, AWAY] });
    press("Resolver agora");
    press("Resolver agora");
    expect(screen.getByTestId("sr-done")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("sr-see-all")).toBeNull());
  });
});

describe("the overview", () => {
  it("replaces the step inside the same dialog: title, kinds, counts, picks and continue", async () => {
    renderResolver();
    press("Ver todos (3)");
    const dialog = screen.getByRole("dialog", { name: "3 problemas a resolver" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "3 problemas a resolver" })).toHaveFocus());
    expect(screen.getByText("Atrasado · 2")).toBeInTheDocument();
    expect(screen.getByText("Pessoa away")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Resolver: / })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continuar em sequência" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { level: 3 })).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("sr-see-all")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("sr-back")).toBeNull());
  });

  it("continue returns to the step it left, with nothing answered", async () => {
    const { props } = renderResolver();
    press("Resolver agora");
    expect(title()).toBe("Pessoa away");
    press("Ver todos (3)");
    press("Continuar em sequência");
    expect(title()).toBe("Pessoa away");
    expect(stepLabel()).toBe("2 de 3");
    expect(screen.getByTestId("sr-back")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sr-close"));
    expect(props.onClose).toHaveBeenCalledWith({ resolved: 1, skipped: 0, total: 3, alsoResolved: 0 });
  });

  it("draws each kind's count as a badge, as the intro does", async () => {
    renderResolver();
    press("Ver todos (3)");
    expect(screen.getByTestId("sr-overview-count-0")).toHaveTextContent("2");
    expect(screen.getByTestId("sr-overview-count-1")).toHaveTextContent("1");
    const row = screen.getByTestId("sr-overview-count-0").closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Atrasado · 2")).toBeInTheDocument();
  });

  it("keeps a half-filled step through Ver todos → Continuar em sequência, and gives it focus back", async () => {
    /** A step with its own state: what the person typed and chose, not yet answered. */
    function HalfFilled({ api, name }: { api: SequenceStepApi<string>; name: string }) {
      const [reason, setReason] = useState("");
      const [picked, setPicked] = useState(false);
      return (
        <div>
          <h3 {...api.titleProps}>{name}</h3>
          <label>
            Motivo
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="button" aria-pressed={picked} onClick={() => setPicked(true)}>
            Passar para alguém
          </button>
        </div>
      );
    }
    renderResolver({
      renderStep: (item, api) => step(item, api, { content: <HalfFilled api={api} name={item.name} /> }),
    });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "trânsito" } });
    press("Passar para alguém");
    press("Ver todos (3)");
    await waitFor(() => expect(screen.getByTestId("sr-step")).not.toBeVisible());
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    press("Continuar em sequência");
    expect(screen.getByLabelText("Motivo")).toHaveValue("trânsito");
    expect(screen.getByRole("button", { name: "Passar para alguém" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Pessoa late-a" })).toHaveFocus());
  });

  it("names the dialog by the overview's title alone while the step is kept under it", async () => {
    renderResolver();
    press("Ver todos (3)");
    const dialog = screen.getByRole("dialog", { name: "3 problemas a resolver" });
    const ids = Array.from(dialog.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    press("Continuar em sequência");
    expect(screen.getByRole("dialog", { name: "Pessoa late-a" })).toBeInTheDocument();
  });

  it("a pick jumps to that kind's first unanswered problem and calls its onPick", async () => {
    const onPick = vi.fn();
    renderResolver({ overview: overview(onPick) });
    press("Ver todos (3)");
    press("Resolver: Avisou que não vai · 1");
    expect(title()).toBe("Pessoa away");
    expect(onPick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("sr-overview")).toBeNull());
  });

  it("skips an answered problem of the kind and lands on the next one", async () => {
    renderResolver();
    press("Resolver agora");
    press("Ver todos (3)");
    press("Resolver: Atrasado · 2");
    expect(title()).toBe("Pessoa late-b");
  });

  it("disables the pick of a kind with nothing left unanswered", async () => {
    renderResolver({ queue: [AWAY, LATE_A, LATE_B] });
    press("Resolver agora");
    press("Ver todos (3)");
    expect(screen.getByRole("button", { name: "Resolver: Avisou que não vai · 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resolver: Atrasado · 2" })).toBeEnabled();
  });

  it("closes with the run's summary from the overview", async () => {
    const { props } = renderResolver();
    press("Ver todos (3)");
    fireEvent.click(screen.getByTestId("sr-close"));
    expect(props.onClose).toHaveBeenCalledWith({ resolved: 0, skipped: 0, total: 3, alsoResolved: 0 });
  });

  it("starts closed on every opening of the resolver", async () => {
    const { rerender } = renderResolver();
    press("Ver todos (3)");
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(screen.queryByTestId("sr-overview")).toBeNull());
    expect(title()).toBe("Pessoa late-a");
  });
});

describe("Back after a jump", () => {
  it("returns to the step on screen before the jump, at once", async () => {
    const onBack = vi.fn();
    renderResolver({ onBack });
    press("Ver todos (3)");
    press("Resolver: Avisou que não vai · 1");
    fireEvent.click(screen.getByTestId("sr-back"));
    expect(title()).toBe("Pessoa late-a");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("then over an answered step awaits the host's inverse with that answer", async () => {
    const onBack = vi.fn(() => Promise.resolve());
    renderResolver({ onBack, queue: [LATE_A, LATE_B, AWAY] });
    press("Resolver agora");
    press("Ver todos (3)");
    press("Resolver: Avisou que não vai · 1");
    fireEvent.click(screen.getByTestId("sr-back"));
    expect(title()).toBe("Pessoa late-b");
    await act(async () => {
      fireEvent.click(screen.getByTestId("sr-back"));
    });
    expect(onBack).toHaveBeenCalledWith(LATE_A, "ok late-a");
    expect(title()).toBe("Pessoa late-a");
  });
});

describe("api.jumpTo", () => {
  it("jumps from a host's own control", async () => {
    renderResolver({
      renderStep: (item, api) => step(item, api, { tertiary: { label: "Ir para ausência", onClick: () => api.jumpTo("away") } }),
    });
    press("Ir para ausência");
    expect(title()).toBe("Pessoa away");
  });
});

describe("initialKey", () => {
  it("opens the run at that problem, with the others still ahead", async () => {
    renderResolver({ initialKey: "away" });
    expect(title()).toBe("Pessoa away");
    expect(stepLabel()).toBe("1 de 3");
    await waitFor(() => expect(screen.queryByTestId("sr-back")).toBeNull());
    press("Resolver agora");
    expect(title()).toBe("Pessoa late-a");
  });
});

describe("a step with canGoBack: false", () => {
  it("hides Back on the next step once it is answered", async () => {
    renderResolver({
      renderStep: (item, api) => step(item, api, item.key === "late-a" ? { canGoBack: false } : {}),
    });
    press("Resolver agora");
    expect(title()).toBe("Pessoa away");
    await waitFor(() => expect(screen.queryByTestId("sr-back")).toBeNull());
    press("Resolver agora");
    expect(screen.getByTestId("sr-back")).toBeInTheDocument();
  });

  it("does not hide Back over a skip of that step", async () => {
    renderResolver({
      renderStep: (item, api) => step(item, api, item.key === "late-a" ? { canGoBack: false } : {}),
    });
    press("Depois");
    expect(screen.getByTestId("sr-back")).toBeInTheDocument();
  });
});
