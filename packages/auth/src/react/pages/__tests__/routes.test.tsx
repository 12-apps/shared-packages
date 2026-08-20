import type { ComponentType, JSX, ReactNode } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuthScreens } from "../../screens";
import { createAuthRoutes } from "../routes";
import { authErrorMessage, AUTH_ERROR_CODES } from "../errors";
import type { AuthRoutesConfig } from "../routes";
import { PT_BR_AUTH_ERRORS, PT_BR_PAGES } from "../pt-BR";

/**
 * The route wiring two host SPAs were each doing by hand.
 *
 * What is pinned here is the wiring, not the card — `pages.test.tsx` covers the
 * assembly. These are the six things that were duplicated: the error map, the
 * base-path pair, the already-signed-in redirect, the settings read, the
 * handoff-failure recovery, and which codes read as advice rather than fault.
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

function TestLink(props: { to: string; children: ReactNode }): JSX.Element {
  const { to, children } = props;
  return <a href={to}>{children}</a>;
}

const Link: AuthRoutesConfig["Link"] = TestLink;

interface Harness {
  navigate: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  config: AuthRoutesConfig;
}

function harness(overrides: Partial<AuthRoutesConfig> = {}): Harness {
  const navigate = vi.fn();
  const signIn = vi.fn(() => Promise.resolve());
  const config: AuthRoutesConfig = {
    screens: screensStub(),
    copy: PT_BR_PAGES,
    routes: { login: "/login", signup: "/signup" },
    Link,
    errors: PT_BR_AUTH_ERRORS,
    useNavigate: () => navigate,
    useSearchParams: () => new URLSearchParams(),
    useSession: () => ({ status: "unauthenticated", signIn }),
    getSettings: () => Promise.resolve({ enabled: true, requireEmailVerification: true }),
    ...overrides,
  };
  return { navigate, signIn, config };
}

describe("createAuthRoutes — the error map that used to be per-host", () => {
  it("answers every Auth.js code it can receive, not a subset", () => {
    for (const code of AUTH_ERROR_CODES) {
      const message = authErrorMessage(code, PT_BR_AUTH_ERRORS);
      expect(message).not.toBe(PT_BR_AUTH_ERRORS.fallback);
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("falls back only for a code the pack does not name", () => {
    expect(authErrorMessage("SomethingAuthJsAddedLater", PT_BR_AUTH_ERRORS)).toBe(
      PT_BR_AUTH_ERRORS.fallback,
    );
  });

  it("renders the sentence for the code in the URL", async () => {
    const { config } = harness({
      useSearchParams: () => new URLSearchParams("error=OAuthAccountNotLinked"),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    expect(await screen.findByText(PT_BR_AUTH_ERRORS.OAuthAccountNotLinked)).toBeTruthy();
  });

  it("paints a user-instruction code as advice, not as a fault", async () => {
    const { config } = harness({
      useSearchParams: () => new URLSearchParams("error=AccessDenied"),
    });
    const { LoginRoute } = createAuthRoutes(config);
    const { container } = render(<LoginRoute />);
    await screen.findByText(PT_BR_AUTH_ERRORS.AccessDenied);
    expect(container.querySelector('[data-testid="login-error"]')).not.toBeNull();
  });
});

describe("createAuthRoutes — the base-path pair", () => {
  it("prefixes the provider callback but NOT the router navigation", async () => {
    const { config, signIn, navigate } = harness({
      basePath: "/admin",
      useSearchParams: () => new URLSearchParams("callbackUrl=/pedidos"),
      renderProviders: ({ start }) => (
        <button type="button" data-testid="google" onClick={() => start("google")}>
          google
        </button>
      ),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    fireEvent.click(await screen.findByTestId("google"));

    // Auth.js must return to the app's real URL...
    expect(signIn).toHaveBeenCalledWith("google", "/admin/pedidos");
    // ...while the router, already mounted under /admin, must not repeat it.
    expect(navigate).not.toHaveBeenCalledWith("/admin/pedidos", expect.anything());
  });
});

describe("createAuthRoutes — the redirect and the settings read", () => {
  it("sends an already-authenticated visitor to the callback instead of the form", async () => {
    const { config, navigate } = harness({
      useSearchParams: () => new URLSearchParams("callbackUrl=/conta"),
      useSession: () => ({ status: "authenticated", signIn: vi.fn() }),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/conta", { replace: true }));
    await waitFor(() => expect(screen.queryByTestId("email-password-form")).toBeNull());
  });

  it("leaves the form hidden when the settings read fails, keeping providers usable", async () => {
    const { config } = harness({
      getSettings: () => Promise.reject(new Error("offline")),
      renderProviders: () => <div data-testid="providers" />,
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    expect(await screen.findByTestId("providers")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("email-password-form")).toBeNull());
  });
});

describe("createAuthRoutes — a failed OAuth handoff", () => {
  it("clears the pending button and explains itself as Configuration", async () => {
    const seen: (string | null)[] = [];
    const { config } = harness({
      useSession: () => ({
        status: "unauthenticated",
        signIn: vi.fn(() => Promise.reject(new Error("csrf failed"))),
      }),
      renderProviders: ({ start, pending }) => {
        seen.push(pending);
        return (
          <button type="button" data-testid="google" onClick={() => start("google")}>
            google
          </button>
        );
      },
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    fireEvent.click(await screen.findByTestId("google"));

    expect(await screen.findByText(PT_BR_AUTH_ERRORS.Configuration)).toBeTruthy();
    // A button left spinning reads as "still working" — the recovery is the
    // point, not only the message.
    await waitFor(() => expect(seen.at(-1)).toBeNull());
  });
});

describe("createAuthRoutes — the sign-up gate", () => {
  function gated(overrides: Partial<AuthRoutesConfig> = {}): Harness {
    return harness({
      signupGate: {
        render: ({ satisfied, setSatisfied }) => (
          <input
            type="checkbox"
            data-testid="accept"
            checked={satisfied}
            onChange={(event) => setSatisfied(event.target.checked)}
          />
        ),
        failureMessage: "Não foi possível registrar o consentimento.",
      },
      ...overrides,
    });
  }

  it("stops the OAuth handoff too, not only the form", async () => {
    const { config, signIn } = gated({
      renderProviders: ({ start }) => (
        <button type="button" data-testid="google" onClick={() => start("google")}>
          google
        </button>
      ),
    });
    const { SignupRoute } = createAuthRoutes(config);
    render(<SignupRoute />);

    // A provider button is a second door to the same account.
    fireEvent.click(await screen.findByTestId("google"));
    expect(signIn).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId("accept"));
    fireEvent.click(await screen.findByTestId("google"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("google", expect.any(String)));
  });

  it("records consent BEFORE the handoff, not after the redirect returns", async () => {
    const order: string[] = [];
    const { config } = gated({
      signupGate: {
        render: ({ satisfied, setSatisfied }) => (
          <input
            type="checkbox"
            data-testid="accept"
            checked={satisfied}
            onChange={(event) => setSatisfied(event.target.checked)}
          />
        ),
        onBeforeProceed: () => {
          order.push("consent");
          return Promise.resolve();
        },
        failureMessage: "Não foi possível registrar o consentimento.",
      },
      useSession: () => ({
        status: "unauthenticated",
        signIn: vi.fn(() => {
          order.push("signIn");
          return Promise.resolve();
        }),
      }),
      renderProviders: ({ start }) => (
        <button type="button" data-testid="google" onClick={() => start("google")}>
          google
        </button>
      ),
    });
    const { SignupRoute } = createAuthRoutes(config);
    render(<SignupRoute />);
    fireEvent.click(await screen.findByTestId("accept"));
    fireEvent.click(await screen.findByTestId("google"));

    // A visitor bounced to Google has already consented; the record of it
    // cannot depend on them making it back.
    await waitFor(() => expect(order).toEqual(["consent", "signIn"]));
  });

  it("says so, in the host's words, when the consent stamp fails", async () => {
    const { config, signIn } = gated({
      signupGate: {
        render: ({ satisfied, setSatisfied }) => (
          <input
            type="checkbox"
            data-testid="accept"
            checked={satisfied}
            onChange={(event) => setSatisfied(event.target.checked)}
          />
        ),
        onBeforeProceed: () => Promise.reject(new Error("offline")),
        failureMessage: "Não foi possível registrar o consentimento.",
      },
      renderProviders: ({ start }) => (
        <button type="button" data-testid="google" onClick={() => start("google")}>
          google
        </button>
      ),
    });
    const { SignupRoute } = createAuthRoutes(config);
    render(<SignupRoute />);
    fireEvent.click(await screen.findByTestId("accept"));
    fireEvent.click(await screen.findByTestId("google"));

    expect(
      await screen.findByText("Não foi possível registrar o consentimento."),
    ).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("createAuthRoutes — a refused callbackUrl", () => {
  it("falls back to the app root, not to the login route", async () => {
    const { config, navigate } = harness({
      // The protocol-relative shape a browser resolves as EXTERNAL.
      useSearchParams: () => new URLSearchParams("callbackUrl=//evil.example.com/steal"),
      useSession: () => ({ status: "authenticated", signIn: vi.fn() }),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);

    // Falling back to `/login` would send a signed-in visitor to the route that
    // redirects signed-in visitors — safe, but they never arrive anywhere.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(navigate).not.toHaveBeenCalledWith("/login", expect.anything());
  });

  it("honours a host served under a sub-path when it refuses one", async () => {
    const { config, navigate } = harness({
      homePath: "/pedidos",
      useSearchParams: () => new URLSearchParams("callbackUrl=https://evil.example.com"),
      useSession: () => ({ status: "authenticated", signIn: vi.fn() }),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/pedidos", { replace: true }));
  });
});

describe("createAuthRoutes — the gate tells the provider slot", () => {
  it("reports the gate as unsatisfied so the slot can disable itself", async () => {
    const seen: boolean[] = [];
    const { config } = harness({
      signupGate: {
        render: ({ satisfied, setSatisfied }) => (
          <input
            type="checkbox"
            data-testid="accept"
            checked={satisfied}
            onChange={(event) => setSatisfied(event.target.checked)}
          />
        ),
        failureMessage: "não deu",
      },
      renderProviders: ({ gateSatisfied }) => {
        seen.push(gateSatisfied);
        return <button type="button" data-testid="google" disabled={!gateSatisfied} />;
      },
    });
    const { SignupRoute } = createAuthRoutes(config);
    render(<SignupRoute />);

    // A button that looks clickable and silently does nothing is worse than
    // one that shows it is not ready — `start` refuses either way.
    expect((await screen.findByTestId("google")).hasAttribute("disabled")).toBe(true);
    fireEvent.click(await screen.findByTestId("accept"));
    await waitFor(() =>
      expect((screen.getByTestId("google") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(seen[0]).toBe(false);
  });

  it("reports satisfied on a route with no gate at all", async () => {
    const seen: boolean[] = [];
    const { config } = harness({
      renderProviders: ({ gateSatisfied }) => {
        seen.push(gateSatisfied);
        return <div data-testid="providers" />;
      },
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    await screen.findByTestId("providers");
    expect(seen.every(Boolean)).toBe(true);
  });
});

describe("createAuthRoutes — the notice keeps its heading and its close button", () => {
  it("shows the code's own title, not just the sentence", async () => {
    const { config } = harness({
      useSearchParams: () => new URLSearchParams("error=AccessDenied"),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    // The storefront switched heading on this code; a description-only Alert
    // dropped it, and an e2e spec caught the loss.
    expect(await screen.findByText("Cadastro necessário")).toBeTruthy();
    expect(await screen.findByText(PT_BR_AUTH_ERRORS.AccessDenied)).toBeTruthy();
  });

  it("falls back to one heading for a code with none of its own", async () => {
    const { config } = harness({
      useSearchParams: () => new URLSearchParams("error=OAuthCallback"),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    expect(await screen.findByText("Falha ao entrar")).toBeTruthy();
  });

  it("can be dismissed — the code lives in the URL and would otherwise persist", async () => {
    const { config } = harness({
      useSearchParams: () => new URLSearchParams("error=OAuthCallback"),
    });
    const { LoginRoute } = createAuthRoutes(config);
    render(<LoginRoute />);
    await screen.findByText("Falha ao entrar");

    // Asserted, not probed: a guarded click would pass silently the day the
    // close button stops rendering, which is the regression this pins.
    fireEvent.click(await screen.findByTestId("alert-close"));
    await waitFor(() => expect(screen.queryByText("Falha ao entrar")).toBeNull());
  });
});
