import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { DeletionReport } from "../../../account-deletion/types";
import { lazyAccountDeletion } from "../lazy";

/**
 * `createWebAuth({ accountDeletion })` and the manifest surface hand out these
 * wrappers so the screens stay off a host's first paint (FUT-5322): the page
 * still draws, once its module has loaded, and one build serves both screens.
 */
const REPORT: DeletionReport = {
  state: "active",
  purgeAt: null,
  graceDays: 15,
  blockers: [],
  forfeits: [],
  confirm: "password",
  freshSignIn: false,
  canSchedule: true,
};

const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: REPORT }), { status: 200, headers: { "content-type": "application/json" } }));

const screens = () =>
  lazyAccountDeletion(
    { mount: "/api/account-deletion", facts: { goes: ["Seu perfil"], stays: [] }, timeZone: "UTC", fetchImpl: fetchImpl as unknown as typeof fetch },
    { useSession: () => ({ signIn: async () => undefined, signOut: async () => undefined }) },
  );

describe("the lazy deletion screens (FUT-5322)", () => {
  // The module the wrappers load, loaded once up front: the cases test the
  // wrappers, not how long a cold transform takes on a busy runner.
  beforeAll(async () => {
    await import("../index");
  });

  it("draws the page once its module has loaded", async () => {
    const { DeleteAccountPage } = screens();
    render(<DeleteAccountPage />);
    expect(await screen.findByRole("heading", { name: "Excluir conta" })).toBeTruthy();
    expect(await screen.findByText("Seu perfil")).toBeTruthy();
  });

  it("draws the pending screen with the purge date", async () => {
    const { PendingDeletionScreen } = screens();
    render(<PendingDeletionScreen purgeAt="2026-12-10T03:00:00.000Z" />);
    expect(await screen.findByTestId("deletion-pending-view")).toBeTruthy();
  });
});
