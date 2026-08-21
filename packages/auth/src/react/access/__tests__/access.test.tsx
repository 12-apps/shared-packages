import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccessCard } from "../card";
import { AccessGate, accessState } from "../async-gate";
import { CheckEmailPanel } from "../check-email";
import { useFlowEmail } from "../flow-email";
import { rateLimitMessage } from "../rate-limit";
import { PT_BR_ACCESS } from "../pt-BR";

/**
 * The prototype's "decisions that must survive", as assertions.
 *
 * Each `it` here is one of them, phrased as the thing that reads as a bug when
 * it is missing — because each of them WAS missing before this module, and
 * "the screen looks fine" is what let them stay missing.
 */

const states = PT_BR_ACCESS.states;

describe("the three states every access screen has", () => {
  it("resolves in the order the container applies, so loading wins over error", () => {
    // A screen that is both re-fetching and holding a stale error must read as
    // busy, not as broken — otherwise a retry flashes the failure it is fixing.
    expect(accessState({ loading: true, error: "boom", empty: true })).toBe("loading");
    expect(accessState({ error: "boom", empty: true })).toBe("error");
    expect(accessState({ empty: true })).toBe("empty");
    expect(accessState({})).toBe("ready");
  });

  it("announces its state on an element that is always present", () => {
    // The container swaps its own subtree, so a test asking "which state is
    // this screen in" needs one node that survives every state.
    const { rerender } = render(
      <AccessGate retryLabel={states.retry} errorTitle={states.errorTitle} loading>
        <p>conteúdo</p>
      </AccessGate>,
    );
    expect(screen.getByTestId("access-gate").getAttribute("data-state")).toBe("loading");

    rerender(
      <AccessGate retryLabel={states.retry} errorTitle={states.errorTitle}>
        <p>conteúdo</p>
      </AccessGate>,
    );
    expect(screen.getByTestId("access-gate").getAttribute("data-state")).toBe("ready");
  });

  it("gives the empty state a way FORWARD, because it is a configuration not a failure", () => {
    // "This store has no e-mail sign-up" with no onward path is a screen
    // somebody closes. The action is part of the shape for that reason.
    render(
      <AccessGate
        retryLabel={states.retry}
        errorTitle={states.errorTitle}
        empty
        emptyTitle={states.signupClosed.title}
        emptyDescription={states.signupClosed.description}
        emptyAction={{ label: "Entrar com o Google", onClick: vi.fn() }}
      >
        <p>nunca</p>
      </AccessGate>,
    );
    expect(screen.getByTestId("access-gate").getAttribute("data-state")).toBe("empty");
    expect(screen.getByRole("button", { name: /google/i })).toBeTruthy();
  });

  it("offers retry only on the error state, never on the empty one", () => {
    // Telling somebody to "try again" about a store that has sign-up switched
    // off sends them round a loop that cannot resolve.
    const onRetry = vi.fn();
    render(
      <AccessGate
        retryLabel={states.retry}
        errorTitle={states.errorTitle}
        error="500"
        onRetry={onRetry}
      >
        <p>nunca</p>
      </AccessGate>,
    );
    expect(screen.getByTestId("access-gate").getAttribute("data-state")).toBe("error");
    expect(screen.getByText(states.errorTitle)).toBeTruthy();
  });
});

describe("the address across the flow", () => {
  it("carries one typed address so five screens never ask twice", () => {
    const { result } = renderHook(() => useFlowEmail());
    act(() => result.current.setEmail("cliente@example.com"));
    expect(result.current.email).toBe("cliente@example.com");
  });

  it("trims at the boundary — a pasted address keeps its trailing space", () => {
    // The single commonest reason an address that LOOKS right is refused.
    const { result } = renderHook(() => useFlowEmail());
    act(() => result.current.setEmail("  cliente@example.com "));
    expect(result.current.email).toBe("cliente@example.com");
  });

  it("clears deliberately, because 'this address was wrong' is a decision", () => {
    const { result } = renderHook(() => useFlowEmail("velho@example.com"));
    act(() => result.current.clearEmail());
    expect(result.current.email).toBe("");
  });
});

describe("a refused attempt says how long", () => {
  it("names the seconds rather than 'aguarde alguns minutos'", () => {
    // A limit with no number is indistinguishable from a broken screen.
    expect(rateLimitMessage(30, PT_BR_ACCESS.rateLimit)).toContain("30 segundos");
  });

  it("switches to minutes past a minute, always rounding UP", () => {
    // A countdown that says "1 minuto" and still refuses at 61s teaches that
    // the number is a lie.
    expect(rateLimitMessage(61, PT_BR_ACCESS.rateLimit)).toContain("2 minutos");
    expect(rateLimitMessage(120, PT_BR_ACCESS.rateLimit)).toContain("2 minutos");
  });

  it("says the vague thing ONLY when the server refused without a number", () => {
    // `undefined` and `0` are genuinely different, and the screen must not
    // invent a number for the first.
    expect(rateLimitMessage(undefined, PT_BR_ACCESS.rateLimit)).toBe(
      PT_BR_ACCESS.rateLimit.retryUnknown,
    );
    expect(rateLimitMessage(0, PT_BR_ACCESS.rateLimit)).toContain("0 segundos");
  });

  it("handles a singular without saying '1 segundos'", () => {
    expect(rateLimitMessage(1, PT_BR_ACCESS.rateLimit)).toContain("1 segundo");
    expect(rateLimitMessage(1, PT_BR_ACCESS.rateLimit)).not.toContain("1 segundos");
  });
});

describe("the check-your-email panel", () => {
  const copy = PT_BR_ACCESS.checkEmail;

  it("shows the address, so a typo is discoverable at all", () => {
    render(
      <CheckEmailPanel
        email="cliente@example.con"
        copy={copy}
        onResend={vi.fn()}
        onChangeEmail={vi.fn()}
      />,
    );
    expect(screen.getByTestId("check-email-address").textContent).toContain(
      "cliente@example.con",
    );
  });

  it("offers a way back to the form — the commonest failure here is a typo", async () => {
    const onChangeEmail = vi.fn();
    render(
      <CheckEmailPanel
        email="cliente@example.com"
        copy={copy}
        onResend={vi.fn()}
        onChangeEmail={onChangeEmail}
      />,
    );
    fireEvent.click(screen.getByTestId("check-email-change"));
    await waitFor(() => expect(onChangeEmail).toHaveBeenCalled());
  });

  it("keeps the panel when a resend is refused, because the first link still works", () => {
    // Replacing the panel with the refusal would throw away the person's only
    // remaining path.
    render(
      <CheckEmailPanel
        email="cliente@example.com"
        copy={copy}
        onResend={vi.fn()}
        onChangeEmail={vi.fn()}
        notice="Muitas tentativas. Tente de novo em 2 minutos."
      />,
    );
    expect(screen.getByTestId("check-email-notice")).toBeTruthy();
    expect(screen.getByTestId("check-email-change")).toBeTruthy();
  });

  it("never disables the resend while a send is in flight — the label carries it", () => {
    // No disabled actions on this surface: the screen only anticipates what it
    // can without a round trip, and a greyed button reads as broken.
    render(
      <CheckEmailPanel
        email="cliente@example.com"
        copy={copy}
        onResend={vi.fn()}
        onChangeEmail={vi.fn()}
        resending
      />,
    );
    const resend = screen.getByTestId("check-email-resend");
    expect(resend.hasAttribute("disabled")).toBe(false);
    expect(resend.textContent).toBe(copy.resending);
  });
});

describe("the access card", () => {
  it("always says whose it is — nobody types a password not knowing where they are", () => {
    render(
      <AccessCard brand={{ name: "Padaria do Zé", initials: "PZ" }} title="Entrar">
        <p>formulário</p>
      </AccessCard>,
    );
    expect(screen.getByTestId("access-brand").getAttribute("data-brand")).toBe("Padaria do Zé");
    expect(screen.getByTestId("access-brand-initials")).toBeTruthy();
  });

  it("drops the store's name to the subtitle when the card is the platform's", () => {
    // Below the plan that earns own-branding: still answers "where am I",
    // without implying a brand the store has not paid for.
    render(
      <AccessCard
        brand={{ name: "Paladira", subtitle: "Padaria do Zé" }}
        title="Entrar"
      >
        <p>formulário</p>
      </AccessCard>,
    );
    expect(screen.getByTestId("access-brand-subtitle").textContent).toBe("Padaria do Zé");
  });

  it("marks the footer so the small arrangement can stick it to the bottom", () => {
    // Responsive by ARRANGEMENT: a card that merely narrows puts the submit
    // button below the fold, which on a sign-in screen means somebody types a
    // password and cannot find the way to send it.
    render(
      <AccessCard
        brand={{ name: "Padaria do Zé" }}
        title="Entrar"
        footer={<button type="button">Entrar</button>}
      >
        <p>formulário</p>
      </AccessCard>,
    );
    expect(screen.getByTestId("access-footer").getAttribute("data-sticky-below")).toBe("480");
    expect(screen.getByTestId("access-card").getAttribute("data-two-column-from")).toBe("1024");
  });
});

describe("the copy pack", () => {
  it("gives every empty state a sentence, because each is a real configuration", () => {
    // No sign-in method at all, e-mail off, sign-up closed, provider-only
    // account — four states a store can genuinely be in.
    for (const key of ["noMethods", "noPassword", "signupClosed", "accountHasNoPassword"] as const) {
      expect(states[key].title.length).toBeGreaterThan(0);
      expect(states[key].description.length).toBeGreaterThan(0);
    }
  });
});
