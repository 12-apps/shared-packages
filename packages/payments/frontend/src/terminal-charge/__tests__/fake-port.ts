import { vi } from 'vitest';

import type {
  TerminalCancelAnswer,
  TerminalCaptureTrace,
  TerminalChargeAnswer,
  TerminalChargeRequest,
  TerminalEvent,
  TerminalMethod,
  TerminalPort,
} from '../port';

/**
 * A fake paired terminal: the station's port with the test in the terminal's
 * seat. It answers pushes and cancels from a script and emits the statuses a
 * real terminal would.
 */
export interface FakeTerminal extends TerminalPort {
  readonly charges: TerminalChargeRequest[];
  readonly cancels: string[];
  /** The ids the pushes were answered with, in order. */
  readonly chargeIds: string[];
  /** The next pushes' answers; past the list, every push is taken. */
  pushAnswers: TerminalChargeAnswer[];
  cancelAnswer: TerminalCancelAnswer;
  emit(event: TerminalEvent): void;
  /** Emit a status for a pushed charge (default: the last). */
  status(
    state: Extract<TerminalEvent, { kind: 'status' }>['state'],
    extra?: { method?: TerminalMethod | 'CASH'; capture?: TerminalCaptureTrace; chargeId?: string },
  ): void;
}

const DEVICE = 'dev-1';

export function trace(amountCents: number, kind: TerminalMethod = 'CREDIT', code = `TX-${amountCents}-${kind}`): TerminalCaptureTrace {
  return {
    transactionCode: code,
    transactionId: `tid-${code}`,
    authorizationCode: 'A1B2C3',
    brand: 'VISA',
    installments: 1,
    serial: 'SERIAL-1',
    entryMode: 'CHIP',
    amountCents,
    kind,
    capturedAt: '2026-11-04T12:00:00.000Z',
  };
}

export function fakeTerminal(): FakeTerminal {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const port: FakeTerminal = {
    charges: [],
    cancels: [],
    chargeIds: [],
    pushAnswers: [],
    cancelAnswer: 'SENT',
    state: vi.fn(async () => ({ listening: [], terminals: [] })),
    charge: vi.fn(async (request: TerminalChargeRequest) => {
      port.charges.push(request);
      const scripted = port.pushAnswers.shift();
      if (scripted !== undefined) return scripted;
      const chargeId = `ch-${port.chargeIds.length + 1}`;
      port.chargeIds.push(chargeId);
      return { ok: true, chargeId, deviceId: request.deviceId ?? DEVICE } as const;
    }),
    cancel: vi.fn(async (chargeId: string) => {
      port.cancels.push(chargeId);
      return port.cancelAnswer;
    }),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (event) => [...listeners].forEach((listener) => listener(event)),
    status: (state, extra = {}) => {
      const chargeId = extra.chargeId ?? port.chargeIds[port.chargeIds.length - 1] ?? 'none';
      port.emit({
        kind: 'status',
        deviceId: DEVICE,
        chargeId,
        state,
        ...(extra.method === undefined ? {} : { method: extra.method }),
        ...(extra.capture === undefined ? {} : { capture: extra.capture }),
      });
    },
  };
  return port;
}

/** Let the pushes' and cancels' promises settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
