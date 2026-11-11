// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DiscountBulkResult, DiscountBulkRow, DiscountBulkState } from "../../bulk";
import type { DiscountsApiClient } from "../api";
import { fill, type DiscountsWebCopy } from "../copy";
import { completeWebCopy } from "../copy-fallback";
import { PT_BR_DISCOUNTS_WEB_COPY } from "../pt-BR";
import { EN_US_DISCOUNTS_WEB_COPY } from "../en-US";
import type { DiscountListItem } from "../row";
import { useBulkActions, type BulkActions } from "../use-bulk-actions";
import { foldRetry, undoableOf, type DiscountsBulkSlotProps } from "../use-discounts-bulk";

/**
 * FUT-4420, the screen's half of the bulk actions: the entries, the extend
 * dialog, and the state the host's slot is handed. The slot here is a stand-in
 * for a host's own report component.
 */

const COPY = completeWebCopy(PT_BR_DISCOUNTS_WEB_COPY, "pt-BR");

const STATE: DiscountBulkState = { active: false, startsAt: null, endsAt: null, windowInZone: true };

function row(id: string, over: Partial<DiscountBulkRow> = {}): DiscountBulkRow {
  return {
    id,
    name: id,
    status: "ok",
    code: "activated",
    message: "ok",
    retryable: false,
    before: STATE,
    after: { ...STATE, active: true },
    ...over,
  };
}

function resultOf(rows: DiscountBulkRow[]): DiscountBulkResult {
  const counts = { ok: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const entry of rows) counts[entry.status] += 1;
  return { operation: "setActive", validateOnly: false, counts, rows };
}

function items(count: number): DiscountListItem[] {
  return Array.from({ length: count }, (_, index) => ({ id: `d${index}` }) as DiscountListItem);
}

let captured: BulkActions | null = null;
let latestSlot: Omit<DiscountsBulkSlotProps, "children"> | null = null;

function Slot(props: DiscountsBulkSlotProps): JSX.Element {
  const { children, ...rest } = props;
  latestSlot = rest;
  return (
    <div data-testid="host-report" data-phase={props.state.phase}>
      {children}
    </div>
  );
}

function Probe({ api, withSlot = true, refresh }: { api: DiscountsApiClient; withSlot?: boolean; refresh: () => void }): JSX.Element {
  const bulk = useBulkActions(api, COPY, refresh, () => {}, withSlot ? Slot : undefined);
  captured = bulk;
  return bulk.frame(<div data-testid="grid" />);
}

function apiWith(bulk: DiscountsApiClient["bulk"]): DiscountsApiClient {
  return { bulk } as unknown as DiscountsApiClient;
}

const action = (id: string) => captured!.actions.find((entry) => entry.id === id)!;

describe("the entries of Ações", () => {
  it("offers the three, in the host's words, and keeps them out of the row menu", () => {
    render(<Probe api={apiWith(vi.fn())} refresh={() => {}} />);
    expect(captured!.actions.map((entry) => entry.label)).toEqual(["Ativar todos", "Desativar todos", "Estender validade…"]);
    expect(captured!.actions.every((entry) => entry.row === false)).toBe(true);
  });

  it("offers none without a host slot: a batch with nowhere to report would be silent", () => {
    render(<Probe api={apiWith(vi.fn())} withSlot={false} refresh={() => {}} />);
    expect(captured!.actions).toEqual([]);
    expect(screen.getByTestId("grid")).toBeTruthy();
  });

  it("renders the grid inside the host's slot", () => {
    render(<Probe api={apiWith(vi.fn())} refresh={() => {}} />);
    expect(screen.getByTestId("host-report").contains(screen.getByTestId("grid"))).toBe(true);
  });
});

describe("running a batch", () => {
  it("sends the selected ids, hands the slot the answer and reloads the grid", async () => {
    const answer = resultOf([row("d0"), row("d1", { status: "unchanged", code: "alreadyActive", before: undefined, after: undefined })]);
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: answer });
    const refresh = vi.fn();
    render(<Probe api={apiWith(bulk)} refresh={refresh} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(2));
    });
    expect(bulk).toHaveBeenCalledWith({ operation: "setActive", ids: ["d0", "d1"], active: true });
    expect(screen.getByTestId("host-report").dataset.phase).toBe("done");
    expect(refresh).toHaveBeenCalled();
    // Only the row that changed is offered to Desfazer.
    expect(latestSlot!.undoable.map((entry) => entry.id)).toEqual(["d0"]);
  });

  it("deactivates with active false", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: resultOf([row("d0")]) });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-deactivate").onSelect(items(1));
    });
    expect(bulk).toHaveBeenCalledWith({ operation: "setActive", ids: ["d0"], active: false });
  });

  it("passes the slot a failed state, with the server's sentence, when the request itself fails", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: false, error: "Sem permissão.", status: 403 });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(1));
    });
    expect(latestSlot!.state).toMatchObject({ phase: "failed", message: "Sem permissão." });
  });

  it("refuses more than 500 before sending anything", async () => {
    const bulk = vi.fn();
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(501));
    });
    expect(bulk).not.toHaveBeenCalled();
    expect(latestSlot!.state).toMatchObject({ phase: "failed", message: fill(COPY.bulk.tooMany, { max: 500 }) });
  });

  it("retries only the failed rows and folds their answers into the same report", async () => {
    const first = resultOf([row("d0"), row("d1", { status: "failed", code: "changedDuringBatch", retryable: true, before: undefined, after: undefined })]);
    const second = resultOf([row("d1")]);
    const bulk = vi.fn().mockResolvedValueOnce({ ok: true, data: first }).mockResolvedValueOnce({ ok: true, data: second });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(2));
    });
    expect(latestSlot!.retryable.map((entry) => entry.id)).toEqual(["d1"]);
    await act(async () => {
      await latestSlot!.retry();
    });
    expect(bulk).toHaveBeenLastCalledWith({ operation: "setActive", ids: ["d1"], active: true });
    expect(latestSlot!.retryable).toEqual([]);
    expect(latestSlot!.undoable.map((entry) => entry.id)).toEqual(["d0", "d1"]);
  });

  it("undoes the ok rows once, with their before and after, and then stops offering it", async () => {
    const done = resultOf([row("d0")]);
    const undone: DiscountBulkResult = { ...resultOf([row("d0", { code: "restored" })]), operation: "undo" };
    const bulk = vi.fn().mockResolvedValueOnce({ ok: true, data: done }).mockResolvedValueOnce({ ok: true, data: undone });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(1));
    });
    await act(async () => {
      await latestSlot!.undo();
    });
    expect(bulk).toHaveBeenLastCalledWith({
      operation: "undo",
      rows: [{ id: "d0", before: STATE, after: { ...STATE, active: true } }],
    });
    expect(latestSlot!.undoable).toEqual([]);
    expect(latestSlot!.state).toMatchObject({ phase: "done", undone: { operation: "undo" } });
    // A second Desfazer does nothing.
    await act(async () => {
      await latestSlot!.undo();
    });
    expect(bulk).toHaveBeenCalledTimes(2);
  });

  it("closes the report on dismiss", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: resultOf([row("d0")]) });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(1));
    });
    act(() => latestSlot!.dismiss());
    expect(screen.getByTestId("host-report").dataset.phase).toBe("idle");
  });
});

describe("Estender validade…", () => {
  function open(bulk: ReturnType<typeof vi.fn>): { settled: Promise<unknown> } {
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = action("bulk-extend").onSelect(items(3)) as Promise<unknown>;
    });
    return { settled };
  }

  it("opens a dialog with the two ways on ONE row of equal parts", async () => {
    open(vi.fn());
    const group = await screen.findByTestId("bulk-extend-mode");
    const buttons = group.querySelectorAll("button");
    expect([...buttons].map((button) => button.textContent)).toEqual(["+ dias", "Nova data"]);
    expect(screen.getByText("Estender validade de 3 descontos")).toBeTruthy();
    expect(screen.getByTestId("discount-bulk-extend-confirm").textContent).toContain("Estender 3");
  });

  it("sends +N dias for every selected discount and settles the selection", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: { ...resultOf([row("d0")]), operation: "extendWindow" } });
    const { settled } = open(bulk);
    const days = (await screen.findByTestId("bulk-extend-days")) as HTMLInputElement;
    fireEvent.change(days, { target: { value: "10" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("discount-bulk-extend-confirm"));
      await settled;
    });
    expect(bulk).toHaveBeenCalledWith({ operation: "extendWindow", ids: ["d0", "d1", "d2"], days: 10 });
  });

  it("sends a new date as an ISO day", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: { ...resultOf([row("d0")]), operation: "extendWindow" } });
    const { settled } = open(bulk);
    fireEvent.click(await screen.findByText("Nova data"));
    const date = (await screen.findByTestId("bulk-extend-date")) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "31122026" } });
    expect(date.value).toBe("31/12/2026");
    await act(async () => {
      fireEvent.click(screen.getByTestId("discount-bulk-extend-confirm"));
      await settled;
    });
    expect(bulk).toHaveBeenCalledWith({ operation: "extendWindow", ids: ["d0", "d1", "d2"], endsOn: "2026-12-31" });
  });

  it("refuses an unfinished or impossible date, and zero days, before sending", async () => {
    const bulk = vi.fn();
    open(bulk);
    const days = (await screen.findByTestId("bulk-extend-days")) as HTMLInputElement;
    fireEvent.change(days, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("discount-bulk-extend-confirm"));
    expect(await screen.findByText(COPY.bulk.daysRequired)).toBeTruthy();
    fireEvent.click(screen.getByText("Nova data"));
    const date = (await screen.findByTestId("bulk-extend-date")) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "31022026" } });
    fireEvent.click(screen.getByTestId("discount-bulk-extend-confirm"));
    expect(await screen.findByText(COPY.bulk.dateInvalid)).toBeTruthy();
    expect(bulk).not.toHaveBeenCalled();
  });

  it("says one discount in the singular, in the title (contract T2)", async () => {
    render(<Probe api={apiWith(vi.fn())} refresh={() => {}} />);
    act(() => {
      void (action("bulk-extend").onSelect(items(1)) as Promise<unknown>).catch(() => {});
    });
    expect(await screen.findByText("Estender validade de 1 desconto")).toBeTruthy();
  });

  it("states the rule of the mode it is in: the date rule under Nova data, the counting rule under + dias", async () => {
    open(vi.fn());
    expect((await screen.findByTestId("bulk-extend-hint")).textContent).toBe(COPY.bulk.extendHintDays);
    fireEvent.click(screen.getByText("Nova data"));
    expect((await screen.findByTestId("bulk-extend-hint")).textContent).toBe(COPY.bulk.extendHintDate);
  });

  it("refuses a date before today in the dialog, before saving", async () => {
    const bulk = vi.fn();
    open(bulk);
    fireEvent.click(await screen.findByText("Nova data"));
    fireEvent.change(await screen.findByTestId("bulk-extend-date"), { target: { value: "01012000" } });
    fireEvent.click(screen.getByTestId("discount-bulk-extend-confirm"));
    expect(await screen.findByText(COPY.bulk.datePast)).toBeTruthy();
    expect(bulk).not.toHaveBeenCalled();
  });

  it("puts the cursor in the days field and Enter confirms", async () => {
    const bulk = vi.fn().mockResolvedValue({ ok: true, data: { ...resultOf([row("d0")]), operation: "extendWindow" } });
    const { settled } = open(bulk);
    const days = (await screen.findByTestId("bulk-extend-days")) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(days));
    await act(async () => {
      fireEvent.keyDown(days, { key: "Enter" });
      await settled;
    });
    expect(bulk).toHaveBeenCalledWith({ operation: "extendWindow", ids: ["d0", "d1", "d2"], days: 7 });
  });

  it("keeps the selection when cancelled: the action's promise rejects", async () => {
    const { settled } = open(vi.fn());
    fireEvent.click(await screen.findByTestId("discount-bulk-extend-cancel"));
    await expect(settled).rejects.toThrow("cancelled");
    await waitFor(() => expect(screen.queryByTestId("bulk-extend-mode")).toBeNull());
  });
});

describe("the pure folds", () => {
  it("foldRetry swaps retried rows in place and recounts", () => {
    const folded = foldRetry(
      resultOf([row("a"), row("b", { status: "failed", code: "failed", retryable: true })]),
      resultOf([row("b")]),
    );
    expect(folded.rows.map((entry) => entry.status)).toEqual(["ok", "ok"]);
    expect(folded.counts).toEqual({ ok: 2, unchanged: 0, skipped: 0, failed: 0 });
  });

  it("undoableOf keeps only ok rows that carry both states", () => {
    expect(undoableOf([row("a"), row("b", { status: "skipped", code: "noEndDate" }), row("c", { before: undefined })]).map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("the bulk copy", () => {
  it("is filled in from the package pack for a host pack written before it", () => {
    const old = Object.fromEntries(
      Object.entries(PT_BR_DISCOUNTS_WEB_COPY).filter(([key]) => key !== "bulk"),
    ) as unknown as DiscountsWebCopy;
    expect(completeWebCopy(old, "en-US").bulk.activateAll).toBe("Activate all");
    expect(completeWebCopy(old, "pt-BR").bulk.activateAll).toBe("Ativar todos");
  });

  it("keeps a host's own sentence and fills only what it lacks", () => {
    const merged = completeWebCopy({ ...PT_BR_DISCOUNTS_WEB_COPY, bulk: { activateAll: "Ligar todos" } }, "pt-BR");
    expect(merged.bulk.activateAll).toBe("Ligar todos");
    expect(merged.bulk.deactivateAll).toBe("Desativar todos");
  });

  it("has the same keys in both packs", () => {
    expect(Object.keys(EN_US_DISCOUNTS_WEB_COPY.bulk).sort()).toEqual(Object.keys(PT_BR_DISCOUNTS_WEB_COPY.bulk).sort());
  });
});

describe("round 1 fixes (FUT-4420)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("B3/N10: a second action while a batch runs is refused, and the entries are hidden", async () => {
    const first = deferred<unknown>();
    const bulk = vi.fn().mockReturnValueOnce(first.promise);
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    let one: Promise<void> = Promise.resolve();
    act(() => {
      one = action("bulk-activate").onSelect(items(3)) as Promise<void>;
    });
    expect(latestSlot!.state.phase).toBe("running");
    // The grid keeps the selection while the promise is pending: no entry may apply a second batch.
    expect(items(3).filter(action("bulk-deactivate").isVisible!)).toEqual([]);
    await act(async () => {
      await action("bulk-deactivate").onSelect(items(1));
    });
    expect(bulk).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ ok: true, data: resultOf([row("d0"), row("d1"), row("d2")]) });
      await one;
    });
    expect(latestSlot!.state).toMatchObject({ phase: "done", result: { counts: { ok: 3 } } });
  });

  it("B3: an answer from a batch the person dismissed is ignored, not shown over the next one", async () => {
    const slow = deferred<unknown>();
    const bulk = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ ok: true, data: resultOf([row("d9")]) });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = action("bulk-activate").onSelect(items(3)) as Promise<void>;
    });
    act(() => latestSlot!.dismiss());
    await act(async () => {
      await action("bulk-deactivate").onSelect(items(1));
    });
    expect(latestSlot!.state).toMatchObject({ phase: "done", result: { counts: { ok: 1 } } });
    await act(async () => {
      slow.resolve({ ok: true, data: resultOf([row("d0"), row("d1"), row("d2")]) });
      await first;
    });
    // The late answer of the first batch did not replace the second one's report.
    expect(latestSlot!.state).toMatchObject({ phase: "done", result: { counts: { ok: 1 } } });
  });

  it("B2: a +N dias whose outcome is unknown is not sent again, and the slot is told", async () => {
    // Nothing answered: the server may have applied it, and a second send would add the days twice.
    const bulk = vi.fn().mockResolvedValue({ ok: false, error: "network" });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = action("bulk-extend").onSelect(items(2)) as Promise<unknown>;
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("discount-bulk-extend-confirm"));
      await settled;
    });
    await waitFor(() => expect(latestSlot!.state.phase).toBe("failed"));
    expect(latestSlot!.state).toMatchObject({ retrySafe: false, message: COPY.bulk.outcomeUnknown });
    expect(latestSlot!.canRetry).toBe(false);
    await act(async () => {
      await latestSlot!.retry();
    });
    expect(bulk).toHaveBeenCalledTimes(1);
  });

  it("B2: a definite refusal (4xx) and an idempotent operation may be sent again", async () => {
    const bulk = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "network" })
      .mockResolvedValueOnce({ ok: true, data: resultOf([row("d0")]) });
    render(<Probe api={apiWith(bulk)} refresh={() => {}} />);
    await act(async () => {
      await action("bulk-activate").onSelect(items(1));
    });
    expect(latestSlot!.canRetry).toBe(true);
    await act(async () => {
      await latestSlot!.retry();
    });
    expect(bulk).toHaveBeenCalledTimes(2);
    expect(latestSlot!.state.phase).toBe("done");
  });

  it("2+: the entries are offered with two rows selected and not with one", () => {
    render(<Probe api={apiWith(vi.fn())} refresh={() => {}} />);
    for (const entry of captured!.actions) {
      expect(items(1).filter(entry.isVisible!)).toEqual([]);
      expect(items(2).filter(entry.isVisible!)).toHaveLength(2);
    }
  });

  it("N9: a client without bulk() offers no entries", () => {
    render(<Probe api={{} as unknown as DiscountsApiClient} refresh={() => {}} />);
    expect(captured!.actions).toEqual([]);
  });
});
