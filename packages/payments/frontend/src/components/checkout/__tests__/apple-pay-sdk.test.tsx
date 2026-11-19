// @vitest-environment jsdom
/**
 * FUT-5372 — Apple's JS SDK, loaded on demand where the browser has no
 * `ApplePaySession` of its own, and Apple's `<apple-pay-button>` it draws.
 *
 * The SDK is driven at the seam a browser provides it: the `<script>` the
 * loader appends is found in `document.head`, the class is installed on
 * `window` the way Apple's script installs it, and the tag's `load` or
 * `error` is fired. Pinned:
 *
 *  - two mounts at once share ONE tag; a load that fails or times out takes
 *    its tag away, and the next mount tries again with one new tag;
 *  - an SDK that arrives after its load was given up on is still Apple's SDK,
 *    never mistaken for Safari's own session;
 *  - a caller's inline loader does not re-run the load on every render;
 *  - the button: Apple's element named by the host's label and language,
 *    pressed by click, Enter or Space, and inert while held.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplePaySessionClass } from "../apple-pay-button";
import { ApplePaySdkButton } from "../apple-pay-sdk-button";
import { APPLE_PAY_SDK_URL, useApplePaySession } from "../apple-pay-sdk";

const scripts = (): HTMLScriptElement[] => [...document.head.querySelectorAll<HTMLScriptElement>(`script[src="${APPLE_PAY_SDK_URL}"]`)];

/** An `ApplePaySession` class; `sdk` marks it the way Apple's SDK marks its own (`isNotWebkit`). */
function sessionClass(options: { canPay?: boolean; sdk?: boolean } = {}): ApplePaySessionClass {
  class Session {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments = () => options.canPay ?? true;
  }
  if (options.sdk) Object.assign(Session, { isNotWebkit: true });
  return Session as unknown as ApplePaySessionClass;
}

function install(Session: ApplePaySessionClass): void {
  (window as { ApplePaySession?: unknown }).ApplePaySession = Session;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const script of scripts()) script.remove();
  delete (window as { ApplePaySession?: unknown }).ApplePaySession;
});

describe("loading Apple's SDK", () => {
  it("appends ONE tag for two mounts at once, and both get the SDK's class once it loads", async () => {
    const first = renderHook(() => useApplePaySession(true));
    const second = renderHook(() => useApplePaySession(true));

    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(first.result.current).toMatchObject({ Session: null, loading: true });
    const Session = sessionClass();
    install(Session);
    await act(async () => scripts()[0]?.onload?.(new Event("load")));

    expect(first.result.current).toMatchObject({ Session, via: "sdk", loading: false });
    expect(second.result.current).toMatchObject({ Session, via: "sdk", loading: false });
    expect(scripts()).toHaveLength(1);
  });

  it("takes a failed tag away, and the next mount tries again with one new tag", async () => {
    const failed = renderHook(() => useApplePaySession(true));
    await waitFor(() => expect(scripts()).toHaveLength(1));
    await act(async () => scripts()[0]?.onerror?.(new Event("error")));

    expect(failed.result.current).toMatchObject({ Session: null, via: null, loading: false });
    expect(scripts()).toHaveLength(0);

    const retry = renderHook(() => useApplePaySession(true));
    await waitFor(() => expect(scripts()).toHaveLength(1));
    expect(retry.result.current.loading).toBe(true);
    await act(async () => scripts()[0]?.onerror?.(new Event("error")));
  });

  it("gives a load up after 15 s, taking its tag away", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useApplePaySession(true));
    expect(scripts()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(hook.result.current).toMatchObject({ Session: null, via: null, loading: false });
    expect(scripts()).toHaveLength(0);
  });

  it("never takes an SDK that arrived after its load was given up on for Safari's own session", async () => {
    vi.useFakeTimers();
    const given = renderHook(() => useApplePaySession(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(given.result.current.Session).toBeNull();
    vi.useRealTimers();
    // The script ran anyway, late: Apple's class is on the window now.
    const Late = sessionClass({ sdk: true });
    install(Late);

    const withoutSdk = renderHook(() => useApplePaySession(false));
    const withSdk = renderHook(() => useApplePaySession(true));

    expect(withoutSdk.result.current).toMatchObject({ Session: null, via: null });
    await waitFor(() => expect(withSdk.result.current).toMatchObject({ Session: Late, via: "sdk" }));
    expect(scripts()).toHaveLength(0);
  });

  it("answers Safari's own session as native, without loading anything", () => {
    const Native = sessionClass();
    install(Native);

    const hook = renderHook(() => useApplePaySession(true));

    expect(hook.result.current).toMatchObject({ Session: Native, via: "native", loading: false });
    expect(scripts()).toHaveLength(0);
  });

  it("loads nothing when the caller does not ask for the SDK", () => {
    const hook = renderHook(() => useApplePaySession(false));

    expect(hook.result.current).toMatchObject({ Session: null, via: null, loading: false });
    expect(scripts()).toHaveLength(0);
  });

  it("runs a caller's inline loader once, however often the caller renders", async () => {
    const Session = sessionClass();
    const calls = { count: 0 };
    const hook = renderHook(() =>
      useApplePaySession(true, async () => {
        calls.count += 1;
        return Session;
      }),
    );
    await waitFor(() => expect(hook.result.current.Session).toBe(Session));

    hook.rerender();
    hook.rerender();

    expect(calls.count).toBe(1);
  });
});

describe("ApplePaySdkButton", () => {
  const element = (): HTMLElement => screen.getByTestId("sdk-button").querySelector("apple-pay-button") as HTMLElement;

  it("draws Apple's element, named by the host's label, in the host's language", () => {
    render(<ApplePaySdkButton label="Pagar com Apple Pay" locale="pt-BR" onPress={vi.fn()} testId="sdk-button" height={5} />);

    expect(element().getAttribute("aria-label")).toBe("Pagar com Apple Pay");
    expect(element().getAttribute("locale")).toBe("pt-BR");
    expect(element().getAttribute("buttonstyle")).toBe("black");
    expect(element().getAttribute("role")).toBe("button");
  });

  it("leaves the language to Apple when the host gives none", () => {
    render(<ApplePaySdkButton label="Pay with Apple Pay" onPress={vi.fn()} testId="sdk-button" height={5} />);

    expect(element().hasAttribute("locale")).toBe(false);
  });

  it("is pressed by a click, Enter and Space", () => {
    const onPress = vi.fn();
    render(<ApplePaySdkButton label="Pagar com Apple Pay" onPress={onPress} testId="sdk-button" height={5} />);

    fireEvent.click(element());
    fireEvent.keyDown(element(), { key: "Enter" });
    fireEvent.keyDown(element(), { key: " " });
    fireEvent.keyDown(element(), { key: "a" });

    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it("does nothing while held, and says why", () => {
    const onPress = vi.fn();
    const { rerender } = render(<ApplePaySdkButton label="Pagar com Apple Pay" onPress={onPress} testId="sdk-button" height={5} held="reason-1" />);

    fireEvent.click(element());
    fireEvent.keyDown(element(), { key: "Enter" });

    expect(onPress).not.toHaveBeenCalled();
    expect(element().getAttribute("aria-disabled")).toBe("true");
    expect(element().getAttribute("aria-describedby")).toBe("reason-1");
    expect(screen.getByTestId("sdk-button").getAttribute("data-held")).toBe("true");

    rerender(<ApplePaySdkButton label="Pagar com Apple Pay" onPress={onPress} testId="sdk-button" height={5} />);
    fireEvent.click(element());

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(element().hasAttribute("aria-disabled")).toBe(false);
  });
});
