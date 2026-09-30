import type { ComponentType, JSX, ReactNode } from "react";

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthPages, TERMS_GATE_TEST_ID, type AuthLink } from "../index";
import { PROVIDER_DIVIDER_TEST_ID } from "../card";
import { SIGNUP_ACTIONS_TEST_ID } from "../signup-actions";
import { PT_BR_PAGES } from "../pt-BR";
import type { EmailAuthScreens } from "../../screens";

/**
 * The page shell that three host pages were each assembling by hand.
 *
 * The forms themselves are stubbed: what is worth pinning here is the ASSEMBLY
 * — that the branding slot renders, that a disabled method hides the form
 * without hiding the providers, that the footer links where the host said.
 */

const Stub = (name: string): ComponentType<Record<string, unknown>> =>
  function StubComponent(): JSX.Element {
    return <div data-testid={name} />;
  };

/**
 * The sign-up form, stubbed down to the one thing the page hands it: where its
 * submit goes. The gate and the providers render THROUGH it when e-mail is on,
 * so a stub that dropped `renderActions` would drop them too.
 */
function SignupFormStub({
  renderActions,
}: {
  renderActions?: (submit: ReactNode) => ReactNode;
}): JSX.Element {
  const submit = (
    <button type="submit" data-testid="signup-submit">
      Criar conta
    </button>
  );
  return <form data-testid="email-signup-form">{renderActions ? renderActions(submit) : submit}</form>;
}

function screensStub(): EmailAuthScreens {
  return {
    EmailPasswordForm: Stub("email-password-form"),
    EmailSignupForm: SignupFormStub,
    ForgotPasswordScreen: Stub("forgot"),
    ResetPasswordScreen: Stub("reset"),
    VerifyEmailScreen: Stub("verify"),
    PasswordSecurityCard: Stub("security-card"),
    PasswordField: Stub("password-field"),
    FailureBanner: Stub("failure-banner"),
    LinkButton: Stub("link-button"),
  } as unknown as EmailAuthScreens;
}

/** The host's own link, as these pages take it. An <a> is enough here. */
function TestLink(props: {
  to: string;
  children: ReactNode;
  "data-testid"?: string;
}): JSX.Element {
  const { to, children, ...rest } = props;
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

const Link: AuthLink = TestLink;

const pages = (): ReturnType<typeof createAuthPages> =>
  createAuthPages({
    screens: screensStub(),
    copy: PT_BR_PAGES,
    routes: { login: "/login", signup: "/signup" },
    Link,
  });

const loginProps = {
  callbackUrl: "/",
  onSignedIn: () => {},
  onForgotPassword: () => {},
  emailEnabled: true,
};

const signupProps = {
  callbackUrl: "/",
  onBeforeSubmit: async () => {},
  onSignedIn: () => {},
  emailEnabled: true,
};

describe("LoginPage", () => {
  it("renders the host's branding slot, untouched", () => {
    // Opaque on purpose: the package must not know what a host puts here.
    const { LoginPage } = pages();
    render(<LoginPage {...loginProps} branding={<img alt="Minha Loja" src="/logo.png" />} />);

    expect(screen.getByAltText("Minha Loja")).toBeTruthy();
  });

  it("hides the e-mail form when the method is off, and keeps the providers", () => {
    // The switch turns off e-mail sign-in, not the page: a store with only
    // Google enabled still needs somewhere to click it.
    const { LoginPage } = pages();
    const { container } = render(
      <LoginPage
        {...loginProps}
        emailEnabled={false}
        providers={<button type="button">Continue with Google</button>}
      />,
    );

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    // Asserted against the rendered markup rather than as a missing element:
    // the form is not REMOVED here, it is never rendered, and saying so this
    // way cannot be read as a race the way a null lookup can.
    expect(container.innerHTML).not.toContain("email-password-form");
    // …and the divider goes with it. "ou" fences the providers off from the
    // form BELOW them; with no form it sits at the bottom of the card promising
    // a second method that does not exist, which reads as a page that failed to
    // load rather than as a Google-only sign-in.
    //
    // This case is the one that shipped broken. The two assertions above were
    // already here and both passed, because neither of them looks at the
    // divider — the state was rendered by this very test and walked past.
    //
    // Asked of the MARKUP by test id, for both reasons this file already gives
    // for the form above: the divider is never rendered rather than removed, so
    // a null lookup would read as a race — and the label is two letters now, so
    // `not.toContain("ou")` would pass or fail on whether some other sentence
    // on the page happens to contain them.
    expect(container.innerHTML).not.toContain(PROVIDER_DIVIDER_TEST_ID);
  });

  it("omits the divider entirely when there are no providers", () => {
    // A lone "ou" fencing off nothing reads as a broken page.
    const { LoginPage } = pages();
    const { container } = render(<LoginPage {...loginProps} />);

    // The title proves the page rendered; the divider's absence is then a fact
    // about this page rather than about timing.
    expect(screen.getByText(PT_BR_PAGES.login.title)).toBeTruthy();
    expect(container.innerHTML).not.toContain(PROVIDER_DIVIDER_TEST_ID);
  });

  it("links its footer at the route the host gave, not a guessed one", () => {
    const { LoginPage } = pages();
    render(<LoginPage {...loginProps} />);

    expect(screen.getByTestId("go-to-signup").getAttribute("href")).toBe("/signup");
  });

  it("renders no footer at all when the host has no sign-up route", () => {
    // A backoffice provisions its accounts. A link to a page that does not
    // exist is worse than no link.
    const noSignup = createAuthPages({
      screens: screensStub(),
      copy: PT_BR_PAGES,
      routes: { login: "/login" },
      Link,
    });
    const { container } = render(<noSignup.LoginPage {...loginProps} />);

    expect(screen.getByText(PT_BR_PAGES.login.title)).toBeTruthy();
    expect(container.innerHTML).not.toContain("go-to-signup");
  });

  it("puts the providers ABOVE the e-mail form, with the divider between them", () => {
    // The order is the product decision this page exists to hold, and it is not
    // visible in any other assertion here: every one of them would pass with the
    // two methods the other way round. It reversed once already (FUT-873 put the
    // form first), so it is worth a test that fails when it moves again.
    const { LoginPage } = pages();
    const { container } = render(
      <LoginPage {...loginProps} providers={<button type="button">Continue with Google</button>} />,
    );

    const order = [...container.querySelectorAll("button, [data-testid]")];
    const providerAt = order.findIndex((node) => /google/i.test(node.textContent ?? ""));
    const dividerAt = order.findIndex(
      (node) => node.getAttribute("data-testid") === PROVIDER_DIVIDER_TEST_ID,
    );
    const formAt = order.findIndex(
      (node) => node.getAttribute("data-testid") === "email-password-form",
    );

    expect(providerAt).toBeGreaterThanOrEqual(0);
    expect(dividerAt).toBeGreaterThan(providerAt);
    expect(formAt).toBeGreaterThan(dividerAt);
  });

  it("renders the host's notice above the form", () => {
    const { LoginPage } = pages();
    render(<LoginPage {...loginProps} notice={<div>Sessão expirada</div>} />);

    expect(screen.getByText("Sessão expirada")).toBeTruthy();
  });
});

describe("SignupPage", () => {
  it("renders the host's terms gate", () => {
    // The gate is the host's because what is being consented to is.
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} termsGate={<label>Aceito os termos</label>} />);

    expect(screen.getByText("Aceito os termos")).toBeTruthy();
  });

  it("passes the host's disabled flag through to the form", () => {
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} disabled />);

    expect(screen.getByTestId("email-signup-form")).toBeTruthy();
  });

  it("links back to login at the host's route", () => {
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} />);

    expect(screen.getByTestId("go-to-login").getAttribute("href")).toBe("/login");
  });

  it("drops the divider when e-mail sign-up is off, keeping the providers", () => {
    // The sign-up twin of the login case: "ou cadastre-se com" is an
    // alternative to the form, so with no form it has nothing to be an
    // alternative to.
    const { SignupPage } = pages();
    const { container } = render(
      <SignupPage
        {...signupProps}
        emailEnabled={false}
        providers={<button type="button">Continue with Google</button>}
      />,
    );

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(container.innerHTML).not.toContain(PROVIDER_DIVIDER_TEST_ID);
  });
});

/** Where each marked node sits in document order, by test id or by its words. */
interface Positions {
  gate: number;
  submit: number;
  divider: number;
  provider: number;
}

function positions(container: HTMLElement): Positions {
  const order = [...container.querySelectorAll("button, [data-testid]")];
  const at = (match: (node: Element) => boolean): number => order.findIndex(match);
  const byId = (id: string) => (node: Element) => node.getAttribute("data-testid") === id;
  return {
    gate: at(byId(TERMS_GATE_TEST_ID)),
    submit: at(byId("signup-submit")),
    divider: at(byId(PROVIDER_DIVIDER_TEST_ID)),
    provider: at((node) => node.tagName === "BUTTON" && /google/i.test(node.textContent ?? "")),
  };
}

const google = <button type="button">Continue with Google</button>;

describe("SignupPage — the gate sits beside what it enables", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts the gate directly above the submit, and the providers under it past the divider", () => {
    // The gate enables BOTH the submit and the providers. It used to sit at the
    // top of the card with the submit at the bottom, a screen apart on a phone,
    // so the order is the thing this page now exists to hold.
    const { SignupPage } = pages();
    const { container } = render(
      <SignupPage {...signupProps} termsGate={<label>Aceito os termos</label>} providers={google} />,
    );

    const at = positions(container);
    expect(at.gate).toBeGreaterThanOrEqual(0);
    expect(at.submit).toBe(at.gate + 1);
    expect(at.divider).toBeGreaterThan(at.submit);
    expect(at.provider).toBeGreaterThan(at.divider);
  });

  it("keeps the gate, the submit and the providers in ONE block", () => {
    const { SignupPage } = pages();
    render(
      <SignupPage {...signupProps} termsGate={<label>Aceito os termos</label>} providers={google} />,
    );

    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);
    expect(block.contains(screen.getByText("Aceito os termos"))).toBe(true);
    expect(block.contains(screen.getByTestId("signup-submit"))).toBe(true);
    expect(block.contains(screen.getByRole("button", { name: /continue with google/i }))).toBe(true);
  });

  it("pins that block to the bottom of the window, and lets the card allow it", () => {
    // Sticky rather than fixed: it rides the window's lower edge only while the
    // form is taller than the window, and sits in its own place otherwise. A
    // card that clipped (MUI's default) would be the scroll container it stuck
    // to — one that never scrolls.
    const { SignupPage } = pages();
    const { container } = render(<SignupPage {...signupProps} providers={google} />);

    const block = getComputedStyle(screen.getByTestId(SIGNUP_ACTIONS_TEST_ID));
    expect(block.position).toBe("sticky");
    expect(block.bottom).toBe("-1px");
    const card = container.querySelector(".MuiPaper-root");
    expect(card).toBeTruthy();
    expect(getComputedStyle(card as Element).overflow).toBe("visible");
  });

  it("says it is pinned only while it hangs below the window", () => {
    // A plain function, not an arrow: the page calls it with `new`.
    const Observer = vi.fn(function observer(
      _report: (entries: Partial<IntersectionObserverEntry>[]) => void,
    ) {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("IntersectionObserver", Observer);
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);
    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);
    const report = (entry: Partial<IntersectionObserverEntry>): void =>
      Observer.mock.calls[0]?.[0]([entry]);
    const floor = { bottom: 640 } as DOMRectReadOnly;

    // The theme's rule marks the edge only while pinned, and is a border
    // either way, so pinning never shifts the layout by its width.
    const unpinnedEdge = getComputedStyle(block).borderTopColor;
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(unpinnedEdge);

    act(() => report({ intersectionRatio: 0.99, boundingClientRect: { bottom: 641 } as DOMRectReadOnly, rootBounds: floor }));
    expect(block.getAttribute("data-pinned")).toBe("true");
    expect(getComputedStyle(block).borderTopColor).not.toBe(unpinnedEdge);

    act(() => report({ intersectionRatio: 1, boundingClientRect: { bottom: 600 } as DOMRectReadOnly, rootBounds: floor }));
    expect(block.getAttribute("data-pinned")).toBe("false");

    // Scrolled PAST: clipped at the top of the window, pinned to nothing.
    act(() => report({ intersectionRatio: 0.5, boundingClientRect: { bottom: 40 } as DOMRectReadOnly, rootBounds: floor }));
    expect(block.getAttribute("data-pinned")).toBe("false");
  });

  it("stays in its own place when pinning it would cover more than half the window", () => {
    // Measured at 320×256 (400% zoom): pinned, the block covered every field
    // at every scroll position and the form could not be filled in.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100_000);
    const Observer = vi.fn(function observer(
      _report: (entries: Partial<IntersectionObserverEntry>[]) => void,
    ) {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("IntersectionObserver", Observer);
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);
    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);

    expect(getComputedStyle(block).position).toBe("static");
    // Its own place is below the window, which is not the same as pinned.
    act(() =>
      Observer.mock.calls[0]?.[0]([
        {
          intersectionRatio: 0.2,
          boundingClientRect: { bottom: 900 } as DOMRectReadOnly,
          rootBounds: { bottom: 256 } as DOMRectReadOnly,
        },
      ]),
    );
    expect(block.getAttribute("data-pinned")).toBe("false");
  });

  /** A ResizeObserver whose callbacks the test fires itself. */
  function stubResizeObserver(): { resized: () => void } {
    // A plain function, not an arrow: the page calls it with `new`.
    const Resize = vi.fn(function resizeObserver(_changed: ResizeObserverCallback) {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", Resize);
    return {
      resized: () =>
        act(() => {
          for (const [changed] of Resize.mock.calls) changed([], {} as ResizeObserver);
        }),
    };
  }

  /** The window becomes `height` tall, and says so. */
  function resizeWindowTo(height: number): void {
    vi.stubGlobal("innerHeight", height);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  it("does not pin because its own content got shorter under the finger", () => {
    // Measured at 320×460: ticking the terms removed the host's hint, the block
    // fell under half the window and jumped to the bottom of it, which put the
    // now-enabled Google button where the checkbox had been.
    vi.stubGlobal("innerHeight", 460);
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(262);
    const observer = stubResizeObserver();
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);
    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);
    expect(getComputedStyle(block).position).toBe("static");

    height.mockReturnValue(221);
    observer.resized();

    expect(getComputedStyle(block).position).toBe("static");
  });

  it("still lets go when its own content grows past the line", () => {
    vi.stubGlobal("innerHeight", 548);
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(262);
    const observer = stubResizeObserver();
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);
    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);
    expect(getComputedStyle(block).position).toBe("sticky");

    height.mockReturnValue(340);
    observer.resized();

    expect(getComputedStyle(block).position).toBe("static");
  });

  it("lets go of the window only well past half of it, so a sliding toolbar does not toggle it", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(262);
    vi.stubGlobal("innerHeight", 548);
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);
    const block = screen.getByTestId(SIGNUP_ACTIONS_TEST_ID);
    const position = (): string => getComputedStyle(block).position;
    expect(position()).toBe("sticky");

    // 57%: past half, short of the release line, so a pinned block stays.
    resizeWindowTo(460);
    expect(position()).toBe("sticky");
    resizeWindowTo(400);
    expect(position()).toBe("static");
    // Back at 57% it stays in place: it pins again only under half.
    resizeWindowTo(460);
    expect(position()).toBe("static");
    resizeWindowTo(548);
    expect(position()).toBe("sticky");
  });

  it("takes a gate handed over as a fragment as one block, not one per part", () => {
    const { SignupPage } = pages();
    render(
      <SignupPage
        {...signupProps}
        termsGate={
          <>
            <label>Aceito os termos</label>
            <p>Aceite para continuar.</p>
          </>
        }
      />,
    );

    const gate = screen.getByTestId(TERMS_GATE_TEST_ID);
    expect(gate.contains(screen.getByText("Aceito os termos"))).toBe(true);
    expect(gate.contains(screen.getByText("Aceite para continuar."))).toBe(true);
  });

  it("with e-mail off, keeps the gate directly above the providers and pins nothing", () => {
    const { SignupPage } = pages();
    const { container } = render(
      <SignupPage
        {...signupProps}
        emailEnabled={false}
        termsGate={<label>Aceito os termos</label>}
        providers={google}
      />,
    );

    const at = positions(container);
    expect(at.provider).toBe(at.gate + 1);
    expect(container.innerHTML).not.toContain(SIGNUP_ACTIONS_TEST_ID);
  });
});

describe("SignupPage — a focused field is never left under the pinned block", () => {
  // Focus scrolling treats a field under a sticky block as "in view" and leaves
  // it there; the page's scroll padding is what tells it otherwise (WCAG
  // 2.4.11). Whatever the host had there before must come back.
  beforeEach(() => {
    document.documentElement.style.setProperty("scroll-padding-bottom", "7px");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("scroll-padding-bottom");
    vi.restoreAllMocks();
  });

  it("reserves nothing when it is too tall to pin, since it then covers nothing", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100_000);
    const { SignupPage } = pages();
    render(<SignupPage {...signupProps} providers={google} />);

    expect(getComputedStyle(document.documentElement).scrollPaddingBottom).toBe("7px");
  });

  it("reserves its height as the page's scroll padding while mounted, and puts it back", () => {
    const { SignupPage } = pages();
    const { unmount } = render(<SignupPage {...signupProps} providers={google} />);

    const reserved = getComputedStyle(document.documentElement).scrollPaddingBottom;
    expect(reserved).toMatch(/^\d+px$/);
    expect(reserved).not.toBe("7px");

    unmount();
    expect(getComputedStyle(document.documentElement).scrollPaddingBottom).toBe("7px");
  });
});

describe("the copy pack", () => {
  it("ships a pt-BR pack for hosts with nothing to say about the phrasing", () => {
    expect(PT_BR_PAGES.login.title).toBe("Entrar");
    expect(PT_BR_PAGES.signup.loginLink).toBe("Entrar");
  });
});

describe("the card width", () => {
  it("defaults wider than the provider-only container's 400", () => {
    // 400 was chosen for a card holding a row of buttons. An e-mail + password
    // pair reads cramped in it, which is what the default here answers.
    const { LoginPage } = pages();
    const { container } = render(<LoginPage {...loginProps} />);

    expect(container.querySelector(".MuiPaper-root")).toBeTruthy();
  });
});
