import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { EN_US_PAGES } from "../pages/en-US";
import { PT_BR_PAGES } from "../pages/pt-BR";
import { SIGNUP_ACTIONS_TEST_ID } from "../pages/signup-actions";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";
import type { SignupPageProps } from "../pages";

/**
 * The e-mail-first sign-up (FUT-3806): the e-mail alone with the other ways
 * in, then — on the first character, with no "next" button — the rest of the
 * form, with a link that brings the other ways back.
 */

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

const OTHER_WAYS = PT_BR_PAGES.signup.otherWays ?? { show: "", hide: "" };

function renderSignup(props: Partial<SignupPageProps> = {}, pages = PT_BR_PAGES): void {
  const signUp = vi.fn(async () => ({ ok: true as const, data: { status: "verification-sent" as const } }));
  const { SignupPage } = createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages,
    useSession,
    transport: { ...createEmailAuth({ basePath: "/api/auth/email" }), signUp },
  });
  render(
    <SignupPage
      callbackUrl="/"
      onBeforeSubmit={async () => {}}
      onSignedIn={() => {}}
      emailEnabled
      emailFirst
      providers={<button type="button" data-testid="google">Continuar com o Google</button>}
      terms={({ providers }) => (
        <p data-testid="terms">{providers ? "com e-mail ou com o Google" : "Ao continuar"}</p>
      )}
      {...props}
    />,
  );
}

const email = (): HTMLInputElement => screen.getByTestId("signup-email") as HTMLInputElement;
/** Put a value in the e-mail, the way typing, pasting or autofill all do: one change. */
const setEmail = (value: string): void => {
  fireEvent.change(email(), { target: { value } });
};
/** Every test hook on the page: what is rendered, read in one pass rather than probed for absence. */
const testIds = (): (string | null)[] =>
  Array.from(document.querySelectorAll("[data-testid]"), (el) => el.getAttribute("data-testid"));
const inputNames = (): string[] =>
  Array.from(screen.getByTestId("email-signup-form").querySelectorAll("input"), (input) => input.name);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("an e-mail-first sign-up", () => {
  it("opens on the e-mail alone, with the other ways in and the notice under it", () => {
    renderSignup();
    expect(inputNames()).toEqual(["email"]);
    expect(testIds()).not.toContain("signup-submit");
    expect(testIds()).not.toContain("signup-other-ways");
    expect(screen.getByTestId("google")).toBeTruthy();
    expect(screen.getByTestId("terms").textContent).toBe("com e-mail ou com o Google");
  });

  it("brings in the rest of the form on the first character, and hides the other ways", async () => {
    renderSignup();
    expect(screen.getByTestId("google")).toBeTruthy();
    setEmail("a");
    await waitFor(() => {
      expect(inputNames()).toEqual(["email", "name", "signup-password"]);
      expect(screen.getByTestId("signup-submit")).toBeTruthy();
      expect(testIds()).not.toContain("google");
      expect(screen.getByTestId("terms").textContent).toBe("Ao continuar");
    });
  });

  it("asks for the phone in the second step when the host asks for one", async () => {
    renderSignup({
      phone: { label: "Celular", format: (typed) => typed, problem: () => null },
    });
    setEmail("ana@example.test");
    await waitFor(() => expect(inputNames()).toEqual(["email", "name", "phone", "signup-password"]));
  });

  it("shows the other ways again from the link under the submit, and hides them from it", async () => {
    renderSignup();
    setEmail("ana@example.test");
    const link = await screen.findByTestId("signup-other-ways");
    expect(link.textContent).toBe(OTHER_WAYS.show);
    expect(link.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(link);
    const google = await screen.findByTestId("google");
    await waitFor(() => {
      expect(link.textContent).toBe(OTHER_WAYS.hide);
      expect(link.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("terms").textContent).toBe("com e-mail ou com o Google");
    });
    // Opening them moves nothing the person was filling in: they come after the link.
    const order = Array.from(
      screen.getByTestId(SIGNUP_ACTIONS_TEST_ID).querySelectorAll("[data-testid]"),
      (el) => el.getAttribute("data-testid"),
    );
    expect(order.indexOf("signup-submit")).toBeLessThan(order.indexOf("signup-other-ways"));
    expect(order.indexOf("signup-other-ways")).toBeLessThan(order.indexOf("google"));

    expect(google).toBeTruthy();
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByTestId("google")).toBeNull());
  });

  it("steps back when the e-mail is emptied, and starts with the other ways hidden next time", async () => {
    renderSignup();
    setEmail("ana@example.test");
    fireEvent.click(await screen.findByTestId("signup-other-ways"));
    await screen.findByTestId("google");
    setEmail("");
    await waitFor(() => expect(inputNames()).toEqual(["email"]));
    expect(screen.getByTestId("google")).toBeTruthy();
    setEmail("b");
    const link = await screen.findByTestId("signup-other-ways");
    await waitFor(() => {
      expect(testIds()).not.toContain("google");
      expect(link.textContent).toBe(OTHER_WAYS.show);
    });
  });

  it("keeps what was typed in the other fields across a step back", async () => {
    renderSignup();
    setEmail("ana@example.test");
    fireEvent.change(await screen.findByTestId("signup-name"), { target: { value: "Ana" } });
    setEmail("");
    await waitFor(() => expect(inputNames()).toEqual(["email"]));
    setEmail("ana@example.test");
    const name = (await screen.findByTestId("signup-name")) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Ana"));
  });

  it("offers no link to other ways when the host has none", async () => {
    renderSignup({ providers: undefined });
    setEmail("ana@example.test");
    await screen.findByTestId("signup-submit");
    await waitFor(() => {
      expect(testIds()).not.toContain("signup-other-ways");
      expect(screen.getByTestId("terms").textContent).toBe("Ao continuar");
    });
  });

  it("says the link in the host's language", async () => {
    renderSignup({}, EN_US_PAGES);
    setEmail("a");
    const link = await screen.findByTestId("signup-other-ways");
    await waitFor(() => expect(link.textContent).toBe("Other ways to sign up"));
  });
});

describe("a sign-up that is not e-mail-first", () => {
  it("is the form as it was: nome, e-mail, password, the submit and the providers, with the notice", () => {
    renderSignup({ emailFirst: false });
    expect(inputNames()).toEqual(["name", "email", "signup-password"]);
    expect(screen.getByTestId("signup-submit")).toBeTruthy();
    expect(screen.getByTestId("google")).toBeTruthy();
    expect(testIds()).not.toContain("signup-other-ways");
    expect(screen.getByTestId("terms").textContent).toBe("com e-mail ou com o Google");
  });

  it("renders the notice under the providers when e-mail sign-up is off", () => {
    renderSignup({ emailEnabled: false });
    expect(testIds()).not.toContain("email-signup-form");
    expect(screen.getByTestId("google")).toBeTruthy();
    expect(screen.getByTestId("terms")).toBeTruthy();
  });
});
