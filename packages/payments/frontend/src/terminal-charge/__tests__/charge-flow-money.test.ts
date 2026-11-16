import { describe, expect, it, vi } from "vitest";

import {
  cancelRequested,
  cashReceived,
  chargedElsewhere,
  chargedSplit,
  confirmLabelOf,
  createConfirmedAct,
  onEvent,
  otherTender,
  pushed,
  pushing,
  readiness,
  resend,
  serverRefused,
  startFlow,
  type ChargeFlow,
  type TerminalCaptureTrace,
  type TerminalEvent,
} from "../index";

/**
 * FUT-4996 (D7) contract: the leg state machine of
 * `@12-apps/payments-frontend/terminal-charge`, pure, one row per case.
 *
 * Salvaged from the branch's `charge-flow.ts` / `charge-run.ts`
 * (the FUT-3765 draft branch, aa78c0b9d) with the K1, K2 and K5
 * defects fixed and the decided states 4, 5 and 6 added. Host-agnostic: no
 * host vocabulary (FUT-5037 A5b), so the leg the operator records at the
 * counter is status `local`.
 *
 * Amended in this PR: R11 follows the owner's decision T2 (2026-11-14): State
 * 4 has no undo window, so `createUndoableAct` became `createConfirmedAct`,
 * which sends at once. State 6 follows the owner's rules of 2026-11-14 (the
 * terminal is the only source of payment truth): R02, R04, R05 and R44 record a
 * manual leg only while the terminal cannot be used, so their flows start from
 * a push refused as NOT_CONNECTED, and a new case pins that a usable terminal
 * offers no manual exit. R06 and R28 assert the exits of a usable terminal.
 * R01's title and R36's fixture copy are in English so the
 * A5b grep over this directory prints nothing, and `status` takes the station's
 * state union rather than a string; the assertions are unchanged.
 */

const LINKED = { known: true as const, terminals: 1 };
const UNKNOWN = { known: false as const };

function trace(overrides: Partial<TerminalCaptureTrace> = {}): TerminalCaptureTrace {
  return {
    transactionCode: "PAG-0001",
    transactionId: "TID-1",
    authorizationCode: "A1",
    brand: "VISA",
    installments: 1,
    serial: "PAX-0001",
    entryMode: "CHIP",
    amountCents: 3200,
    kind: "CREDIT",
    capturedAt: "2026-11-14T17:31:00.000Z",
    ...overrides,
  };
}

/** A one-leg card split of `cents`, pushed and waiting on charge `ch-1`. */
function waiting(cents = 3200, tender = "CREDIT"): ChargeFlow {
  const flow = startFlow({ legs: [{ tender, amountCents: cents }], changeCents: 0 }, cents, LINKED);
  if (flow === null) throw new Error("no flow");
  return pushed(pushing(flow, 0), 0, { ok: true, chargeId: "ch-1", deviceId: "dev-1" });
}

/**
 * A one-leg split the station refused to push because the terminal is not
 * connected: the terminal cannot be used, so the manual exits are offered.
 */
function terminalDown(cents = 3200, tender = "CREDIT"): ChargeFlow {
  const flow = startFlow({ legs: [{ tender, amountCents: cents }], changeCents: 0 }, cents, LINKED);
  return pushed(pushing(flow, 0), 0, { ok: false, code: "NOT_CONNECTED" });
}

const status = (state: Extract<TerminalEvent, { kind: "status" }>["state"], capture?: TerminalCaptureTrace, chargeId = "ch-1") =>
  ({ kind: "status", deviceId: "dev-1", chargeId, state, ...(capture ? { capture } : {}) }) as const;

describe("K1 · A1: no card or Pix leg settles without its proof", () => {
  it("R01: while the link state is unknown, the confirm waits — no split is emitted, and a failed read stays waiting", () => {
    const flow = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, UNKNOWN);

    expect(flow).not.toBeNull();
    expect(readiness(flow as ChargeFlow)).toBe("waiting-link");
    expect(() => chargedSplit(flow as ChargeFlow)).toThrow();
  });

  it("R02: with a terminal linked, every card or Pix leg of the split carries a capture or a manual `elsewhere`, never neither", () => {
    const approved = onEvent(waiting(), status("approved", trace())).flow;
    const elsewhere = chargedElsewhere(terminalDown(), 0, { via: "OTHER_MACHINE", reference: "004512" });

    expect(chargedSplit(approved).legs).toEqual([expect.objectContaining({ tender: "CREDIT", amountCents: 3200, capture: expect.objectContaining({ transactionCode: "PAG-0001" }) })]);
    expect(chargedSplit(elsewhere).legs).toEqual([{ tender: "CREDIT", amountCents: 3200, elsewhere: { via: "OTHER_MACHINE", reference: "004512" } }]);
    expect(() => chargedSplit(waiting())).toThrow();
  });

  it("R03: with no terminal linked, card legs are plain as before and nothing waits", () => {
    const flow = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, { known: true, terminals: 0 });

    expect(readiness(flow as ChargeFlow)).toBe("ready");
    expect(chargedSplit(flow as ChargeFlow).legs).toEqual([{ tender: "CREDIT", amountCents: 3200 }]);
  });
});

describe("State 6 · A10: the terminal is down, the counter never freezes", () => {
  it("R44: NOT_CONNECTED leaves the leg refused, offering Mandar de novo, Outra forma and the two State 6 exits, its method preselected", () => {
    const flow = startFlow({ legs: [{ tender: "DEBIT", amountCents: 4600 }], changeCents: 0 }, 4600, LINKED) as ChargeFlow;
    const refused = pushed(pushing(flow, 0), 0, { ok: false, code: "NOT_CONNECTED" });

    expect(refused.legs[0]).toMatchObject({ status: "refused", exits: ["resend", "other-tender", "other-machine", "manual-pix"], preselected: "DEBIT" });
  });

  it("R04: 'Cobrei em outra máquina', only while the terminal cannot be used, records a manual OTHER_MACHINE leg with an optional NSU", () => {
    const flow = chargedElsewhere(terminalDown(4600, "DEBIT"), 0, { via: "OTHER_MACHINE" });

    expect(readiness(flow)).toBe("ready");
    expect(flow.legs[0]).toMatchObject({ status: "manual", capture: null });
    expect(chargedSplit(flow).legs).toEqual([{ tender: "DEBIT", amountCents: 4600, elsewhere: { via: "OTHER_MACHINE" } }]);
  });

  it("R05: 'Recebi por Pix manual', only while the terminal cannot be used, turns the leg into a manual PIX marked MANUAL_PIX", () => {
    const flow = chargedElsewhere(terminalDown(4600, "CREDIT"), 0, { via: "MANUAL_PIX" });

    expect(chargedSplit(flow).legs).toEqual([{ tender: "PIX", amountCents: 4600, elsewhere: { via: "MANUAL_PIX" } }]);
  });

  it("R04/R05 (owner rule): while the terminal can be used its word is the only one — no manual exit, and a manual leg is refused", () => {
    const declined = onEvent(waiting(), status("declined")).flow;

    expect(waiting().legs[0]?.exits).not.toContain("other-machine");
    expect(declined.legs[0]?.exits).toEqual(["resend", "other-tender"]);
    expect(() => chargedElsewhere(waiting(), 0, { via: "OTHER_MACHINE" })).toThrow();
    expect(() => chargedElsewhere(declined, 0, { via: "MANUAL_PIX" })).toThrow();
  });

  it("R01/R04: the link the flow holds decides — a failed read or no terminal connected offers the manual exits under Outra forma", () => {
    const failed = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, { known: false, failed: true });
    const down = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, { known: true, terminals: 1, down: true });

    expect(failed.legs[0]?.exits).toEqual(["other-tender", "other-machine", "manual-pix"]);
    expect(down.legs[0]?.exits).toEqual(["other-tender", "other-machine", "manual-pix"]);
    expect(readiness(chargedElsewhere(failed, 0, { via: "MANUAL_PIX" }))).toBe("ready");
  });

  it("R01 (N2): before the station's first answer the flow waits with Outra forma only — no manual exit while loading", () => {
    const loading = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, UNKNOWN);

    expect(readiness(loading)).toBe("waiting-link");
    expect(loading.legs[0]?.exits).toEqual(["other-tender"]);
    expect(() => chargedElsewhere(loading, 0, { via: "MANUAL_PIX" })).toThrow();
  });

  it("R06: a waiting leg has no clock: hours of silence leave it waiting, with its exits", () => {
    vi.useFakeTimers();
    try {
      const flow = waiting();
      vi.advanceTimersByTime(6 * 60 * 60_000);
      expect(flow.legs[0]).toMatchObject({ status: "waiting" });
      expect(readiness(flow)).toBe("charging");
      expect(flow.legs[0]?.exits).toEqual(expect.arrayContaining(["cancel", "other-tender"]));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("K2 · State 4: received twice is never applied silently", () => {
  it("R07: a late approval for a leg already received in cash leaves it cash and raises `received-twice` with the capture", () => {
    const cancelled = onEvent(waiting(), status("cancelled")).flow;
    const cash = cashReceived(otherTender(cancelled, "CASH"));

    const move = onEvent(cash, status("approved", trace()));

    expect(move.flow.legs[0]).toMatchObject({ status: "local", tender: "CASH" });
    expect(move.notice).toEqual({ kind: "received-twice", index: 0, capture: expect.objectContaining({ transactionCode: "PAG-0001", amountCents: 3200 }) });
    expect(chargedSplit(move.flow).legs).toEqual([{ tender: "CASH", amountCents: 3200 }]);
  });

  it("R07: the same when the terminal itself moved the charge to cash (method_changed → CASH) before approving", () => {
    const moved = onEvent(waiting(), { ...status("method_changed"), method: "CASH" } as never).flow;
    const cash = cashReceived(moved);

    expect(onEvent(cash, status("approved", trace())).notice).toMatchObject({ kind: "received-twice" });
  });

  it("R47 (control): a late approval for a charge cancelled with nothing else received IS the leg's", () => {
    const cancelling = cancelRequested(waiting(), 0);
    const cancelled = onEvent(cancelling, status("cancelled")).flow;

    const move = onEvent(cancelled, status("approved", trace()));

    expect(move.flow.legs[0]).toMatchObject({ status: "approved" });
    expect(move.notice).toBeNull();
  });

  it("R11 (T2): no undo window — the act is sent at once with its reason and PIN; a short reason or no PIN sends nothing", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(async () => ({ ok: true as const }));
      const act = createConfirmedAct({ send });

      await expect(act.confirm({ act: "refund", reason: "ok", pin: "1234" })).resolves.toEqual({ ok: false, problem: "reason" });
      await expect(act.confirm({ act: "refund", reason: "paid twice", pin: " " })).resolves.toEqual({ ok: false, problem: "pin" });
      expect(send).not.toHaveBeenCalled();

      await expect(act.confirm({ act: "refund", reason: " paid twice ", pin: "1234" })).resolves.toEqual({ ok: true });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ act: "refund", reason: "paid twice", pin: "1234" });
      expect(act.state()).toBe("sent");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("K5 · A5: the capture's amount is the leg's", () => {
  it("R14: an approval for another amount takes the captured amount and re-balances the open legs to the total", () => {
    const flow = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3000 }, { tender: "PIX" }], changeCents: 0 }, 5000, LINKED) as ChargeFlow;
    const sent = pushed(pushing(flow, 0), 0, { ok: true, chargeId: "ch-1", deviceId: "dev-1" });

    const move = onEvent(sent, status("approved", trace({ amountCents: 3150 })));

    expect(move.flow.legs[0]).toMatchObject({ status: "approved", amountCents: 3150 });
    expect(move.flow.legs[1]).toMatchObject({ amountCents: 1850 });
  });

  it("R15: an approval above what remains of the total raises `excess` with the amount over", () => {
    const move = onEvent(waiting(3200), status("approved", trace({ amountCents: 3400 })));

    expect(move.notice).toEqual({ kind: "excess", excessCents: 200 });
    expect(readiness(move.flow)).toBe("decide");
  });

  it("R16: a body the server refused as not fitting is never resent as is: the flow asks the operator", () => {
    const approved = onEvent(waiting(), status("approved", trace())).flow;

    const refused = serverRefused(approved, "TENDERS_DONT_FIT");

    expect(readiness(refused)).toBe("decide");
    expect(refused.retry).toBe(false);
  });

  it("R43: CAPTURE_CONTENDED is transient: the held capture stays and the same body may be sent again", () => {
    const approved = onEvent(waiting(), status("approved", trace())).flow;

    const contended = serverRefused(approved, "CAPTURE_CONTENDED");

    expect(contended.retry).toBe(true);
    expect(chargedSplit(contended)).toEqual(chargedSplit(approved));
  });

  it("R48: an edit lowers the total mid-split: at or under the captured, the open parts drop; above it, the excess", () => {
    const flow = startFlow({ legs: [{ tender: "CREDIT", amountCents: 4600 }, { tender: "PIX", amountCents: 3200 }], changeCents: 0 }, 7800, LINKED) as ChargeFlow;
    const first = onEvent(pushed(pushing(flow, 0), 0, { ok: true, chargeId: "ch-1", deviceId: "dev-1" }), status("approved", trace({ amountCents: 4600 }))).flow;

    const covered = startFlow({ legs: chargedSplit(first, { partial: true }).legs, changeCents: 0 }, 4600, LINKED) as ChargeFlow;
    const below = startFlow({ legs: chargedSplit(first, { partial: true }).legs, changeCents: 0 }, 4000, LINKED) as ChargeFlow;

    expect(covered.legs).toHaveLength(1);
    expect(readiness(covered)).toBe("ready");
    expect(readiness(below)).toBe("decide");
  });
});

describe("A9: CAPTURE_CONFLICT", () => {
  it("R28: the leg is `conflict`, never 'nothing was charged'; it offers another tender, and the capture is not reused", () => {
    const approved = onEvent(waiting(), status("approved", trace())).flow;

    const conflict = serverRefused(approved, "CAPTURE_CONFLICT");

    expect(conflict.legs[0]).toMatchObject({ status: "conflict", charged: true, exits: ["other-tender"] });
    expect(conflict.retry).toBe(false);
  });
});

describe("the races", () => {
  it("R41: the same approval twice is one approval; a second, distinct capture for the leg is an orphan, never applied", () => {
    const once = onEvent(waiting(), status("approved", trace())).flow;
    const twice = onEvent(once, status("approved", trace()));
    const other = onEvent(once, status("approved", trace({ transactionCode: "PAG-0002" })));

    expect(twice.flow).toEqual(once);
    expect(twice.notice).toBeNull();
    expect(other.flow).toEqual(once);
    expect(other.notice).toEqual({ kind: "orphan", capture: expect.objectContaining({ transactionCode: "PAG-0002" }) });
  });

  it("R45: after a reload, a charge still pending on the terminal is shown waiting and can be cancelled; its later approval is an orphan for a NEW sale", () => {
    const reloaded = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, { ...LINKED, pending: { chargeId: "ch-old", amountCents: 3200, method: "CREDIT" } }) as ChargeFlow;

    expect(reloaded.pending).toMatchObject({ chargeId: "ch-old", cancellable: true });
    const move = onEvent(reloaded, { kind: "orphan-capture", deviceId: "dev-1", chargeId: "ch-old", state: "approved", capture: trace() } as never);
    expect(move.flow.legs[0]).toMatchObject({ status: "send" });
    expect(move.notice).toEqual({ kind: "orphan", capture: expect.objectContaining({ transactionCode: "PAG-0001" }) });
  });

  it("R44 (resend): 'Mandar de novo' after a decline pushes a fresh charge, never re-approves the old one", () => {
    const declined = onEvent(waiting(), status("declined")).flow;

    expect(resend(declined).legs[0]).toMatchObject({ status: "send", chargeId: null });
  });
});

describe("A11: the confirm", () => {
  it("R36: the confirm reads the terminal label ('… R$ X on the terminal') while a terminal leg is next, and the plain label otherwise", () => {
    const words = { receive: (money: string) => `Charge ${money}`, receiveOnTerminal: (money: string) => `Charge ${money} on the terminal`, money: (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}` };
    const terminal = startFlow({ legs: [{ tender: "CREDIT", amountCents: 3200 }], changeCents: 0 }, 3200, LINKED) as ChargeFlow;
    const cash = startFlow({ legs: [{ tender: "CASH", amountCents: 3200 }], changeCents: 0 }, 3200, LINKED) as ChargeFlow;

    expect(confirmLabelOf(terminal, words)).toBe("Charge R$ 32,00 on the terminal");
    expect(confirmLabelOf(cash, words)).toBe("Charge R$ 32,00");
  });
});

