import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createEmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { PT_BR_PAGES } from "../pages/pt-BR";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * The show/hide toggle belongs to the password field's own box (FUT-3475).
 *
 * It used to be positioned by hand over the field (`top: 18`), which put it on
 * the bottom border with the `<input>` running underneath it — two things drawn
 * over each other. As the field's end adornment the field lays it out: inside
 * the same input root as the `<input>`, after it, and the `<input>` stops short.
 */

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

function renderSignup(): void {
  const { SignupPage } = createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages: PT_BR_PAGES,
    useSession,
    transport: createEmailAuth({ basePath: "/api/auth/email" }),
  });
  render(<SignupPage callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} emailEnabled />);
}

afterEach(cleanup);

describe("the password field's show/hide toggle", () => {
  it("sits inside the field's input root, after the input", () => {
    renderSignup();
    const input = screen.getByLabelText(SCREEN_COPY.signUp.passwordLabel);
    const toggle = screen.getByTestId("signup-password-toggle");

    const root = input.closest(".MuiInputBase-root");
    expect(root).not.toBeNull();
    expect(root?.contains(toggle)).toBe(true);
    expect(input.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still shows and hides the password", () => {
    renderSignup();
    const input = screen.getByLabelText(SCREEN_COPY.signUp.passwordLabel);
    const toggle = screen.getByTestId("signup-password-toggle");

    expect(input.getAttribute("type")).toBe("password");
    fireEvent.click(toggle);
    expect(input.getAttribute("type")).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe(SCREEN_COPY.passwordField.hideAria);
    fireEvent.click(toggle);
    expect(input.getAttribute("type")).toBe("password");
  });
});
