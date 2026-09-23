import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailAuthFailure } from "../../email-credentials/types";
import { createEmailAuth, type EmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { PT_BR_PAGES } from "../pages/pt-BR";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * The sign-up password hint, and the refusal banner it sits under, as the
 * product owner asked for them (FUT-2393).
 *
 * The hint states the rule: 8 characters, a letter and a number. It stays in the
 * secondary ink until the password has FAILED — the field was left with a
 * password outside the rule, or the server refused the password as weak — and
 * then it turns the error colour with the field's own outline, and back again
 * once the password is fixed. Leaving the field is what judges it, never a
 * keystroke. The refusal banner floats over the page instead of sitting in the
 * form's flow, and keyboard focus keeps clear of it.
 */

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

/** A transport whose sign-up refuses every attempt for `reason`. */
function refusingTransport(reason: EmailAuthFailure): EmailAuth {
  return {
    ...createEmailAuth({ basePath: "/api/auth/email" }),
    signUp: vi.fn(async () => ({
      ok: false as const,
      reason,
      violations: reason === "weak-password" ? ["too-common"] : undefined,
    })),
  };
}

function renderSignup(reason: EmailAuthFailure = "weak-password"): void {
  const { SignupPage } = createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages: PT_BR_PAGES,
    useSession,
    transport: refusingTransport(reason),
  });
  render(
    <SignupPage callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} emailEnabled />,
  );
}

const hintColour = (): string => getComputedStyle(screen.getByTestId("signup-password-hint")).color;
const passwordInput = (): HTMLElement => screen.getByLabelText(SCREEN_COPY.signUp.passwordLabel);
const emailInput = (): HTMLElement => screen.getByLabelText(/E-mail/);
const toggle = (): HTMLElement => screen.getByTestId("signup-password-toggle");
const invalid = (): string | null => passwordInput().getAttribute("aria-invalid");

/** Fill the e-mail and the password, and send the form. */
async function submitWith(password: string): Promise<void> {
  fireEvent.change(emailInput(), { target: { value: "ana@example.test" } });
  fireEvent.change(passwordInput(), { target: { value: password } });
  fireEvent.submit(screen.getByTestId("email-signup-form"));
  await screen.findByTestId("auth-failure");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the sign-up password hint", () => {
  it("does not judge a password while it is being typed", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.change(passwordInput(), { target: { value: "abc" } });

    expect(hintColour()).toBe(idle);
    expect(invalid()).toBe("false");
  });

  it("turns red when the field is left with a password outside the rule, and back once it fits", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.change(passwordInput(), { target: { value: "abc" } });
    fireEvent.blur(passwordInput());
    expect(hintColour()).not.toBe(idle);
    expect(invalid()).toBe("true");

    fireEvent.change(passwordInput(), { target: { value: "Tijolo-Verde-2026" } });
    expect(hintColour()).toBe(idle);
    expect(invalid()).toBe("false");
  });

  it("leaves an empty field that was only passed through alone, and the typing after it", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.blur(passwordInput());
    expect(hintColour()).toBe(idle);

    // The first keystroke after the pass-through is still typing, not leaving.
    fireEvent.change(passwordInput(), { target: { value: "a" } });
    expect(hintColour()).toBe(idle);
    expect(invalid()).toBe("false");
  });

  it("judges a slip after a fix when the field is left again, not on the keystroke", () => {
    renderSignup();
    const idle = hintColour();
    fireEvent.change(passwordInput(), { target: { value: "abc" } });
    fireEvent.blur(passwordInput());
    fireEvent.change(passwordInput(), { target: { value: "abc12345" } });
    expect(hintColour()).toBe(idle);

    fireEvent.change(passwordInput(), { target: { value: "abc1234" } });
    expect(hintColour()).toBe(idle);

    fireEvent.blur(passwordInput());
    expect(hintColour()).not.toBe(idle);
  });

  it("counts the field's own show/hide toggle as part of the field", () => {
    renderSignup();
    const idle = hintColour();
    fireEvent.change(passwordInput(), { target: { value: "abc" } });

    // Pressing it keeps focus in the input: the press's default is cancelled.
    expect(fireEvent.mouseDown(toggle())).toBe(false);
    // Tabbing onto it is still inside the field.
    fireEvent.blur(passwordInput(), { relatedTarget: toggle() });
    expect(hintColour()).toBe(idle);

    // Going on from it to the next field is leaving.
    fireEvent.blur(toggle(), { relatedTarget: emailInput() });
    expect(hintColour()).not.toBe(idle);
  });

  it("turns red when the server refuses the password, even one that fits the stated rule", async () => {
    // "abc12345" has 8 characters, a letter and a number, and the server's
    // common-password list refuses it (FUT-2396). The refusal is what failed it.
    renderSignup();
    const idle = hintColour();

    await submitWith("abc12345");
    expect(hintColour()).not.toBe(idle);

    fireEvent.change(passwordInput(), { target: { value: "abc123456" } });
    expect(hintColour()).toBe(idle);
  });

  it("stays grey when the refusal is about something other than the password", async () => {
    renderSignup("email-taken");
    const idle = hintColour();

    await submitWith("Tijolo-Verde-2026");

    expect(screen.getByTestId("auth-failure").getAttribute("data-reason")).toBe("email-taken");
    expect(hintColour()).toBe(idle);
    expect(invalid()).toBe("false");
  });
});

describe("the refusal banner", () => {
  it("floats over the page on an opaque layer, above the host's header", async () => {
    renderSignup();

    await submitWith("abc12345");

    const layer = getComputedStyle(screen.getByTestId("auth-failure-layer"));
    expect(layer.position).toBe("fixed");
    // Opaque, so the fields it covers do not read through it.
    expect(["", "transparent", "rgba(0, 0, 0, 0)"]).not.toContain(layer.backgroundColor);
    // Over an app bar (MUI's 1100) and the sign-up actions block.
    expect(Number(layer.zIndex)).toBeGreaterThan(1100);
  });

  it("renders at the end of the document, out of the form's column", async () => {
    renderSignup();

    await submitWith("abc12345");

    const layer = screen.getByTestId("auth-failure-layer");
    expect(layer.parentElement).toBe(document.body);
    expect(screen.getByTestId("email-signup-form").contains(layer)).toBe(false);
  });

  it("stays the same node while the form under it changes", async () => {
    renderSignup();
    await submitWith("abc12345");
    const layer = screen.getByTestId("auth-failure-layer");

    fireEvent.change(passwordInput(), { target: { value: "abc123456" } });
    fireEvent.change(emailInput(), { target: { value: "bia@example.test" } });

    expect(screen.getByTestId("auth-failure-layer")).toBe(layer);
  });

});

describe("the refusal banner and keyboard focus", () => {
  // Focus scrolling treats a control under a fixed layer as "in view" and
  // leaves it there; the page's scroll padding is what tells it otherwise
  // (WCAG 2.4.11). Whatever the host had there before must come back.
  beforeEach(() => {
    document.documentElement.style.setProperty("scroll-padding-top", "8px");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("scroll-padding-top");
  });

  /** jsdom lays nothing out: give the named elements (test id, else id) a box. */
  function place(boxes: Record<string, { top: number; bottom: number; left: number; right: number }>): void {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const box = boxes[this.dataset.testid ?? this.id];
      if (!box) return measure.call(this);
      const { top, bottom, left, right } = box;
      return { top, bottom, left, right, x: left, y: top, width: right - left, height: bottom - top } as DOMRect;
    });
  }

  const LAYER = { top: 76, bottom: 196, left: 16, right: 304 };

  /** Focus the name field, the way a keyboard lands on it. */
  async function focusName(): Promise<void> {
    const name = screen.getByLabelText(SCREEN_COPY.signUp.nameLabel);
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the refusal reads the focused control off `document.activeElement`, so the field has to take focus for real; a dispatched focusin would leave it on the body.
      name.focus();
    });
  }

  it("reserves its bottom edge as the root's scroll padding while it is up, and gives the host's back", async () => {
    const root = document.documentElement;
    place({ "auth-failure-layer": LAYER });
    renderSignup();

    await submitWith("abc12345");
    // The refusal's bottom edge and the gap: focus scrolling stops below it.
    // Published by an effect, which may run after the refusal is in the DOM.
    await waitFor(() => {
      expect(root.style.scrollPaddingTop).toBe("calc(196px + 12px)");
    });

    // The Alert collapses before it reports the close.
    fireEvent.click(screen.getByRole("button", { name: SCREEN_COPY.dismissFailure }));
    await waitForElementToBeRemoved(() => screen.queryByTestId("auth-failure-layer"));
    expect(root.style.scrollPaddingTop).toBe("8px");
  });

  it("closes when focus lands on a control whose middle it covers, which no scrolling can clear", async () => {
    // The top of the page: the name field sits under the refusal, all but a
    // 10px sliver at its bottom edge — none of what it says shows.
    place({ "auth-failure-layer": LAYER, "signup-name": { top: 148, bottom: 206, left: 24, right: 296 } });
    renderSignup();
    await submitWith("abc12345");

    await focusName();

    await waitForElementToBeRemoved(() => screen.queryByTestId("auth-failure-layer"));
  });

  it("stays up over a control whose middle shows", async () => {
    place({ "auth-failure-layer": LAYER, "signup-name": { top: 180, bottom: 236, left: 24, right: 296 } });
    renderSignup();
    await submitWith("abc12345");
    // The check runs on the frame after the focus; hand that frame over now.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      await focusName();
      act(() => {
        vi.advanceTimersToNextFrame();
      });

      expect(screen.getByTestId("auth-failure-layer").isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays up when what takes focus sits over it, like a menu opened on top", async () => {
    // Where the boxes overlap the browser says what is on top; here, the
    // focused control itself.
    place({ "auth-failure-layer": LAYER, "signup-name": { top: 100, bottom: 156, left: 24, right: 296 } });
    renderSignup();
    await submitWith("abc12345");
    const field = screen.getByLabelText(SCREEN_COPY.signUp.nameLabel);
    Object.defineProperty(document, "elementFromPoint", { value: () => field, configurable: true });
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      await focusName();
      act(() => {
        vi.advanceTimersToNextFrame();
      });

      expect(screen.getByTestId("auth-failure-layer").isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});

describe("the refusal opening over the control that has focus", () => {
  // Enter pressed in a field submits from that field: the refusal opens with
  // focus already under it, and no focus moves for the scroll padding to steer.

  /**
   * jsdom lays nothing out and has no `scrollIntoView`. Put the name field
   * under the refusal, at the top of the page, and give the page a scroll that
   * moves the field to `scrolledTo`, or nowhere when the page cannot scroll.
   */
  function stage(scrolledTo?: { top: number; bottom: number }): ReturnType<typeof vi.fn> {
    const boxes: Record<string, { top: number; bottom: number; left: number; right: number }> = {
      "auth-failure-layer": { top: 76, bottom: 196, left: 16, right: 304 },
      "signup-name": { top: 100, bottom: 156, left: 24, right: 296 },
    };
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const box = boxes[this.dataset.testid ?? this.id];
      if (!box) return measure.call(this);
      const { top, bottom, left, right } = box;
      return { top, bottom, left, right, x: left, y: top, width: right - left, height: bottom - top } as DOMRect;
    });
    const scrollIntoView = vi.fn(() => {
      if (scrolledTo) boxes["signup-name"] = { ...scrolledTo, left: 24, right: 296 };
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
    return scrollIntoView;
  }

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  /** Type in the name field and submit from it, as Enter there does. */
  async function submitFromName(): Promise<HTMLElement> {
    const name = screen.getByLabelText(SCREEN_COPY.signUp.nameLabel);
    await act(async () => {
      // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the refusal reads the control that holds focus when it opens, so the field has to hold it for real.
      name.focus();
    });
    await submitWith("abc12345");
    return name;
  }

  it("scrolls that control clear when the page can, and leaves focus on it", async () => {
    // The page had room: scrolling brings the field below the refusal.
    const scrollIntoView = stage({ top: 260, bottom: 316 });
    renderSignup();

    const name = await submitFromName();

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
  });

  it("takes focus onto itself where nothing scrolls, and gives it back when it closes", async () => {
    stage();
    renderSignup();

    const name = await submitFromName();

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("auth-failure"));
    });
    fireEvent.click(screen.getByRole("button", { name: SCREEN_COPY.dismissFailure }));
    await waitForElementToBeRemoved(() => screen.queryByTestId("auth-failure-layer"));
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
  });
});
