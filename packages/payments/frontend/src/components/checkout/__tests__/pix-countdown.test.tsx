// @vitest-environment jsdom
/**
 * FUT-1181 + FUT-592 — the Pix code's deadline as a countdown (option A of the
 * owner's 2026-10-28 prototype): "expira em MM:SS" beside the title, a bar
 * that drains under it, amber with one sentence in the last two minutes, on
 * BOTH faces of the list's Pix (before and after the copy), and a status ask
 * the moment it reaches zero instead of the next, possibly decayed, poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import {
  PIX_FULL_WINDOW_MS,
  PixCountdown,
  formatCountdown,
  pixCountdownAt,
  pixRemainingMs,
  usePixCountdown,
} from "../pix-countdown";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const copy = PT_BR_PAYMENT_LIST_COPY.pixFace;
const NOW = Date.parse("2026-10-28T15:00:00.000Z");
const inMs = (ms: number): string => new Date(NOW + ms).toISOString();

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("the clock's arithmetic", () => {
  it("reads MM:SS rounded up to the second, so 00:00 means lapsed", () => {
    expect(formatCountdown(15 * 60_000)).toBe("15:00");
    expect(formatCountdown(15 * 60_000 - 999)).toBe("15:00");
    expect(formatCountdown(15 * 60_000 - 1000)).toBe("14:59");
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5000)).toBe("00:00");
  });

  it("reads a window of an hour or more as H:MM:SS", () => {
    expect(formatCountdown(60 * 60_000)).toBe("1:00:00");
    expect(formatCountdown(75 * 60_000 + 5000)).toBe("1:15:05");
  });

  it("knows no time left for an unreadable expiry, and never a negative one", () => {
    expect(pixRemainingMs("not a date", NOW)).toBeNull();
    expect(pixRemainingMs(inMs(-60_000), NOW)).toBe(0);
    expect(pixRemainingMs(inMs(90_000), NOW)).toBe(90_000);
  });

  it("turns urgent as the clock shows 01:59, never at zero, and fills the bar against its window", () => {
    expect(pixCountdownAt(120_000, PIX_FULL_WINDOW_MS).urgent).toBe(false);
    expect(pixCountdownAt(119_001, PIX_FULL_WINDOW_MS).urgent).toBe(false);
    expect(pixCountdownAt(119_000, PIX_FULL_WINDOW_MS).urgent).toBe(true);
    expect(pixCountdownAt(1, PIX_FULL_WINDOW_MS).urgent).toBe(true);
    expect(pixCountdownAt(0, PIX_FULL_WINDOW_MS)).toMatchObject({ urgent: false, lapsed: true, fraction: 0 });
    expect(pixCountdownAt(PIX_FULL_WINDOW_MS / 2, PIX_FULL_WINDOW_MS).fraction).toBe(0.5);
    expect(pixCountdownAt(PIX_FULL_WINDOW_MS * 2, PIX_FULL_WINDOW_MS).fraction).toBe(1);
  });
});

function Probe({ expiresAt, onLapse }: { expiresAt: string; onLapse?: () => void }) {
  const state = usePixCountdown(expiresAt, onLapse);
  if (!state) return <p data-testid="no-clock">sem relógio</p>;
  return <PixCountdown state={state} copy={copy} title={<p>Pague R$ 27,00 com Pix</p>} />;
}

const clock = (): string => screen.getByTestId("pix-countdown-clock").textContent ?? "";
/** Advance the clock a second at a time, letting each tick render (the chain re-arms per render). */
function seconds(count: number): void {
  for (let i = 0; i < count; i += 1) act(() => void vi.advanceTimersByTime(1000));
}

/** The bar's fill, in percent, as the browser resolved it. */
const barWidth = (): number => Number.parseFloat(getComputedStyle(screen.getByTestId("pix-countdown-bar")).width);

describe("the countdown on screen", () => {
  it("ticks every second from a fresh fifteen-minute code, with the bar full", () => {
    vi.useFakeTimers({ now: NOW });
    render(<Probe expiresAt={inMs(15 * 60_000)} />);
    expect(clock()).toBe("expira em 15:00");
    expect(barWidth()).toBe(100);
    expect(screen.getByTestId("pix-countdown-clock").getAttribute("role")).toBe("timer");
    act(() => void vi.advanceTimersByTime(1000));
    expect(clock()).toBe("expira em 14:59");
    seconds(59);
    expect(clock()).toBe("expira em 14:00");
  });

  it("drains against fifteen minutes when it first sees a code with ten left", () => {
    vi.useFakeTimers({ now: NOW });
    render(<Probe expiresAt={inMs(10 * 60_000)} />);
    expect(barWidth()).toBeCloseTo(66.67, 2);
  });

  it("drains a longer window from full", () => {
    vi.useFakeTimers({ now: NOW });
    render(<Probe expiresAt={inMs(30 * 60_000)} />);
    expect(barWidth()).toBe(100);
    seconds(15 * 60);
    expect(barWidth()).toBe(50);
  });

  it("says the last two minutes in amber, and that an expired code costs nothing", () => {
    vi.useFakeTimers({ now: NOW });
    render(<Probe expiresAt={inMs(2 * 60_000 + 1000)} />);
    expect(screen.getByTestId("pix-countdown").getAttribute("data-urgent")).toBe("false");
    expect(screen.getByTestId("pix-countdown").textContent).not.toContain(copy.lastMinutes);
    act(() => void vi.advanceTimersByTime(1000));
    expect(clock()).toBe("expira em 02:00");
    expect(screen.getByTestId("pix-countdown").textContent).not.toContain(copy.lastMinutes);
    act(() => void vi.advanceTimersByTime(1000));
    expect(clock()).toBe("expira em 01:59");
    expect(screen.getByTestId("pix-countdown").getAttribute("data-urgent")).toBe("true");
    expect(screen.getByTestId("pix-countdown-urgent").textContent).toBe(
      "Menos de 2 minutos. Se expirar, é só gerar outro — nada é cobrado.",
    );
  });

  it("asks once as it reaches zero, and stops ticking", () => {
    vi.useFakeTimers({ now: NOW });
    const onLapse = vi.fn();
    const { rerender } = render(<Probe expiresAt={inMs(2000)} onLapse={onLapse} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLapse).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLapse).toHaveBeenCalledTimes(1);
    expect(clock()).toBe("expira em 00:00");
    expect(screen.getByTestId("pix-countdown").getAttribute("data-urgent")).toBe("false");
    rerender(<Probe expiresAt={inMs(2000)} onLapse={onLapse} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(onLapse).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks at once for a code already past its expiry", () => {
    vi.useFakeTimers({ now: NOW });
    const onLapse = vi.fn();
    render(<Probe expiresAt={inMs(-30_000)} onLapse={onLapse} />);
    expect(onLapse).toHaveBeenCalledTimes(1);
    expect(clock()).toBe("expira em 00:00");
  });

  it("asks again for a NEW code that lapses", () => {
    vi.useFakeTimers({ now: NOW });
    const onLapse = vi.fn();
    const { rerender } = render(<Probe expiresAt={inMs(-1000)} onLapse={onLapse} />);
    rerender(<Probe expiresAt={inMs(1000)} onLapse={onLapse} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(onLapse).toHaveBeenCalledTimes(2);
  });

  it("draws no clock for an expiry it cannot read, rather than a wrong one", () => {
    const onLapse = vi.fn();
    render(<Probe expiresAt="never" onLapse={onLapse} />);
    expect(screen.getByTestId("no-clock")).toBeTruthy();
    expect(onLapse).not.toHaveBeenCalled();
  });
});

describe("the list's Pix", () => {
  function raising(expiresAt: string) {
    return vi.fn(
      async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
        ok: true,
        data: orderFor(input.method, { pix: { copyPaste: "00020126BR.GOV.BCB.PIX.o-pix", expiresAt } }),
      }),
    );
  }

  async function pixRaised(expiresAt: string) {
    // The clock pinned to NOW, still running: the list's own waits are real.
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    const client = stubClient([]);
    renderList({ config: onPageStore(), client, createOrder: raising(expiresAt) });
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-pix");
    return client;
  }

  it("shows the countdown beside the title before the copy, and keeps it after", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => undefined) } });
    await pixRaised(inMs(14 * 60_000 + 30_000));
    expect(screen.getByTestId("list-pix-title").textContent).toBe("Pague R$ 27,00 com Pix");
    expect(clock()).toMatch(/^expira em 14:(29|30)$/);
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("pix-after-copy");
    expect(screen.getByTestId("list-pix-title").textContent).toBe("Pague R$ 27,00 com Pix");
    expect(clock()).toMatch(/^expira em 14:(2\d|30)$/);
  });

  it("asks the server the moment the code lapses, not at the next poll", async () => {
    const client = await pixRaised(inMs(1500));
    // The opening ask, then nothing until the next 2.5 s poll — except the lapse's.
    await waitFor(() => expect(client.getStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getStatus).toHaveBeenCalledTimes(2), { timeout: 2400 });
    expect(clock()).toBe("expira em 00:00");
  });

  it("says nothing automatic about a Pix the store confirms", async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    const client = stubClient([]);
    const createOrder = vi.fn(
      async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
        ok: true,
        data: orderFor(input.method, {
          pix: { copyPaste: "00020126BR.GOV.BCB.PIX.o-pix", expiresAt: inMs(600_000), confirmation: "MANUAL" },
        }),
      }),
    );
    renderList({ config: onPageStore(), client, createOrder });
    await screen.findByTestId("payment-list");
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-pix");
    expect(screen.getByTestId("list-pix-how").textContent).toBe("Copie e cole no app do seu banco, em Pix Copia e Cola.");
  });

  it("opens the QR under its link on a phone, with what to do with it", async () => {
    await pixRaised(inMs(600_000));
    const qr = screen.getByTestId("list-pix-qr");
    expect(qr.style.display === "none" || getComputedStyle(qr).display === "none").toBe(true);
    fireEvent.click(screen.getByTestId("list-pix-toggle-qr"));
    expect(getComputedStyle(screen.getByTestId("list-pix-qr")).display).toBe("flex");
    expect(screen.getByTestId("list-pix-qr").textContent).toContain(copy.qrCaption);
    expect(screen.getByTestId("list-pix-toggle-qr").textContent).toBe("Ocultar QR code");
  });
});
