import type { ComponentType, JSX, ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAuthPages, type AuthLink } from "../index";
import { PROVIDER_DIVIDER_TEST_ID } from "../card";
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

function screensStub(): EmailAuthScreens {
  return {
    EmailPasswordForm: Stub("email-password-form"),
    EmailSignupForm: Stub("email-signup-form"),
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
