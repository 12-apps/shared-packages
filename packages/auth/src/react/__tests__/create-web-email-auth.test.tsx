import type { JSX, ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createEmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";
import { PT_BR_PAGES } from "../pages/pt-BR";
import type { AuthLink } from "../pages";

/**
 * The three doors that let a MULTI-ROUTER host adopt this surface.
 *
 * `createWebEmailAuth` was written for the one-router case, which is every host
 * until it is not. A repo whose SPAs share one sign-in module — a storefront, a
 * backoffice and an operator console, three routers and one of them under a
 * basename — could not name a single `Link` at factory time and could not hand
 * over the transport its shell already owned, so its only route was to re-run
 * the three-factory composition by hand. That is exactly the recipe this
 * factory exists to stop hosts getting subtly wrong, and re-deriving it is what
 * kept the packaged web manifest unbindable there.
 */

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

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

function build(overrides: Partial<Parameters<typeof createWebEmailAuth>[0]> = {}) {
  return createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages: PT_BR_PAGES,
    useSession,
    ...overrides,
  });
}

const loginProps = {
  callbackUrl: "/",
  onSignedIn: () => {},
  onForgotPassword: () => {},
  emailEnabled: true,
};

describe("createWebEmailAuth", () => {
  it("takes the host's transport instead of building a second one", () => {
    // The failure this closes is not a type error: two clients that merely
    // AGREE about their base path keep working until somebody changes one, and
    // then a forgotten password 404s on a screen nobody exercises until they
    // need it.
    const transport = createEmailAuth({ basePath: "/somewhere/else" });

    expect(build({ transport }).client).toBe(transport);
  });

  it("builds its own transport when the host hands none over", () => {
    const surface = build();

    expect(surface.client).toBeDefined();
    expect(surface.client).not.toBe(build().client);
  });

  it("renders the pages without a cross-link when no Link is named", () => {
    // Absence is a STATEMENT here — "I serve several routers" — so the footer
    // is omitted, exactly as omitting `routes.signup` already omits it. The
    // refused alternative was defaulting to a plain anchor, which would turn
    // the one cross-link on a sign-in page into a full page load, silently, in
    // the SPA hosts this package is written for.
    const { LoginPage } = build();
    const { container } = render(<LoginPage {...loginProps} />);

    // The title proves the page rendered, so the footer's absence is a fact
    // about this page rather than about timing. `getAllByText` because the real
    // screens render here and the word appears on the submit button too.
    expect(screen.getAllByText(PT_BR_PAGES.login.title).length).toBeGreaterThan(0);
    // Asserted against the rendered markup rather than as a missing element:
    // the footer is not REMOVED here, it is never rendered, and saying so this
    // way cannot be read as a race the way a null lookup can — the argument
    // `pages.test.tsx` already makes for the same shape of claim.
    expect(container.innerHTML).not.toContain("go-to-signup");
    expect(container.innerHTML).not.toContain(PT_BR_PAGES.login.signupLink);
  });

  it("still renders the cross-link for the one-router host that names a Link", () => {
    const { LoginPage } = build({ Link, routes: { login: "/entrar", signup: "/criar-conta" } });
    render(<LoginPage {...loginProps} />);

    expect(screen.getByTestId("go-to-signup").getAttribute("href")).toBe("/criar-conta");
  });

  it("builds another router's pages off the SAME screens", () => {
    // One transport and one session across every router, which is the whole
    // reason this door is here rather than in a second factory call.
    const surface = build();
    const forAdmin = surface.createPages({
      copy: PT_BR_PAGES,
      routes: { login: "/admin/login" },
      Link,
    });

    render(<forAdmin.SignupPage callbackUrl="/" onSignedIn={() => {}} emailEnabled />);
    expect(screen.getByTestId("go-to-login").getAttribute("href")).toBe("/admin/login");
  });

  it("builds another router's whole route pair, which the pages alone are not", () => {
    // `createAuthRoutes` is the layer ABOVE the pages — the `?callbackUrl` read,
    // the redirect for a visitor already signed in, the settings probe and the
    // Auth.js code-to-sentence map. It was reachable only by importing it
    // separately, so a host adopting this surface through the wiring contract
    // got the pages and had to compose the routes itself.
    const surface = build();
    const routes = surface.createRoutes({
      copy: PT_BR_PAGES,
      routes: { login: "/login", signup: "/signup" },
      Link,
      errors: { default: "Não foi possível entrar." },
      useNavigate: () => vi.fn(),
      useSearchParams: () => new URLSearchParams(),
      useSession: () => ({ status: "unauthenticated" }) as never,
      getSettings: async () => ({ emailSignInEnabled: true, requireEmailVerification: false }),
    });

    expect(typeof routes.LoginRoute).toBe("function");
    expect(typeof routes.SignupRoute).toBe("function");
  });
});
