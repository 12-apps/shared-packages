import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeletionReport } from "../../../account-deletion/types";
import { createWebAccountDeletion } from "../index";

/**
 * "Excluir minha conta" and the pending-deletion screen, over a scripted
 * fetch: the screens decide nothing, so each case is "the route answered X,
 * the screen shows Y and sends Z".
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const READY: DeletionReport = {
  state: "active",
  purgeAt: null,
  graceDays: 15,
  blockers: [],
  forfeits: [],
  confirm: "password",
  freshSignIn: false,
  canSchedule: true,
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function screens(report: DeletionReport, answers: Response[] = []) {
  const queue = [...answers];
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" ? (queue.shift() ?? json(200, { data: {} })) : json(200, { data: report }),
  );
  const signIn = vi.fn(async () => undefined);
  const signOut = vi.fn(async () => undefined);
  const navigate = vi.fn();
  const feature = createWebAccountDeletion(
    {
      mount: "/api/account-deletion",
      facts: { goes: ["Seu perfil"], stays: ["Seus pedidos, sem seu nome"] },
      timeZone: "UTC",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      navigate,
    },
    { useSession: () => ({ signIn, signOut }) },
  );
  return { ...feature, fetchImpl, signIn, signOut, navigate };
}

const posts = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("the Excluir minha conta page", () => {
  it("shows the host's facts and the blockers, with the button disabled", async () => {
    const { DeleteAccountPage } = screens({
      ...READY,
      canSchedule: false,
      blockers: [{ kind: "order", label: "Um pedido em andamento na Loja.", href: "/pedidos/1" }],
    });
    render(<DeleteAccountPage blockerAction={() => "Ver pedido"} />);
    expect(await screen.findByRole("heading", { name: "Excluir conta" })).toBeTruthy();
    expect(screen.getByText("Seu perfil")).toBeTruthy();
    expect(screen.getByTestId("delete-account-blockers").textContent).toContain("Um pedido em andamento na Loja.");
    expect(screen.getByRole("link", { name: "Ver pedido" }).getAttribute("href")).toBe("/pedidos/1");
    expect((screen.getByTestId("delete-account-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows what is given up as a warning, and still lets the person go on", async () => {
    const { DeleteAccountPage } = screens({
      ...READY,
      forfeits: [{ kind: "credit", label: "Loja", amount: "R$ 18,50", href: "/creditos" }],
    });
    render(<DeleteAccountPage forfeitAction={(kind) => (kind === "credit" ? "Usar ou pedir devolução" : "Usar antes")} />);
    const notice = await screen.findByTestId("delete-account-forfeits");
    expect(notice.textContent).toContain("R$ 18,50 Loja");
    expect(notice.textContent).not.toContain("—");
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.getByRole("link", { name: "Usar ou pedir devolução" }).getAttribute("href")).toBe("/creditos");
    expect(notice.textContent).toContain("Você perde:");
    await waitFor(() => expect(screen.queryByTestId("delete-account-blockers")).toBeNull());
  });

  it("answers a wrong password with an alert and focuses the field again, keeping what was typed", async () => {
    const { DeleteAccountPage, navigate } = screens(READY, [json(403, { error: "Senha incorreta.", code: "wrong-password" })]);
    render(<DeleteAccountPage />);
    const input = (await screen.findByLabelText("Sua senha")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "errada" } });
    fireEvent.click(screen.getByTestId("delete-account-submit"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Senha incorreta.");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe("errada");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("submits on Enter, signs this browser out and leaves", async () => {
    const { DeleteAccountPage, fetchImpl, signOut, navigate } = screens(READY, [json(200, { data: { purgeAt: "2026-12-04T15:00:00.000Z" } })]);
    render(<DeleteAccountPage />);
    const input = await screen.findByLabelText("Sua senha");
    fireEvent.change(input, { target: { value: "certa" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(JSON.parse(String((posts(fetchImpl)[0]?.[1] as RequestInit).body))).toEqual({ password: "certa" });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("sends an account with no password to a fresh sign-in, then lets it confirm without one", async () => {
    const first = screens({ ...READY, confirm: "google", freshSignIn: false });
    const view = render(<first.DeleteAccountPage />);
    fireEvent.click(await screen.findByTestId("delete-account-google"));
    expect(first.signIn).toHaveBeenCalledWith("google", undefined);
    await waitFor(() => expect(screen.queryByLabelText("Sua senha")).toBeNull());
    expect((screen.getByTestId("delete-account-submit") as HTMLButtonElement).disabled).toBe(true);
    view.unmount();

    const fresh = screens({ ...READY, confirm: "google", freshSignIn: true }, [json(200, { data: { purgeAt: "2026-12-04T15:00:00.000Z" } })]);
    render(<fresh.DeleteAccountPage />);
    fireEvent.click(await screen.findByTestId("delete-account-submit"));
    await waitFor(() => expect(fresh.navigate).toHaveBeenCalledWith("/"));
    expect(JSON.parse(String((posts(fresh.fetchImpl)[0]?.[1] as RequestInit).body))).toEqual({});
  });
});

describe("the pending-deletion screen", () => {
  it("names the date, and cancelling signs in again", async () => {
    const { PendingDeletionScreen, fetchImpl, signOut, navigate } = screens(READY, [json(200, { data: { cancelled: true } })]);
    render(<PendingDeletionScreen purgeAt="2026-12-04T15:00:00.000Z" />);
    expect(screen.getByRole("heading").textContent).toBe("Sua conta será excluída em 4 de dezembro");
    fireEvent.click(screen.getByTestId("deletion-pending-cancel"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login"));
    expect(String(posts(fetchImpl)[0]?.[0])).toBe("/api/account-deletion/cancel");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("says why a cancel failed and gives focus back to the button", async () => {
    const { PendingDeletionScreen, navigate } = screens(READY, [json(409, { error: "Sua conta não tem exclusão marcada.", code: "not-scheduled" })]);
    render(<PendingDeletionScreen purgeAt="2026-12-04T15:00:00.000Z" />);
    fireEvent.click(screen.getByTestId("deletion-pending-cancel"));
    expect((await screen.findByRole("alert")).textContent).toBe("Sua conta não tem exclusão marcada.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("deletion-pending-cancel")));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signs out and leaves", async () => {
    const { PendingDeletionScreen, signOut, navigate } = screens(READY);
    render(<PendingDeletionScreen purgeAt="2026-12-04T15:00:00.000Z" />);
    fireEvent.click(screen.getByTestId("deletion-pending-sign-out"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
