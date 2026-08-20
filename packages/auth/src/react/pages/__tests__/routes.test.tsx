import type { ComponentType, JSX, ReactNode } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuthScreens } from "../../screens";
import { createAuthRoutes, authErrorMessage, AUTH_ERROR_CODES } from "../routes";
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
