import { describe, expect, it } from "vitest";

import { deriveShellStatus, INITIAL_SHELL_STATE, isWorking, type ShellState } from "../status";

const state = (patch: Partial<ShellState> = {}): ShellState => ({
  ...INITIAL_SHELL_STATE,
  ...patch,
});

describe("deriveShellStatus", () => {
  it("starts unknown rather than guessing either answer", () => {
    expect(deriveShellStatus(state())).toBe("starting");
  });

  it("reports the session before the link", () => {
    // An agent with no session also has no link. Reporting `disconnected`
    // would send somebody to debug a network that is fine.
    expect(deriveShellStatus(state({ session: "signed-out", link: "disconnected" }))).toBe(
      "signed-out",
    );
  });

  it("ranks a local fault above the link, because the link recovers on its own", () => {
    expect(
      deriveShellStatus(state({ session: "signed-in", fault: "no-printer", link: "connected" })),
    ).toBe("faulted");
  });

  it("is online only when signed in, faultless and connected", () => {
    expect(deriveShellStatus(state({ session: "signed-in", link: "connected" }))).toBe("online");
  });

  it("calls a dropped link degraded, not an error", () => {
    expect(deriveShellStatus(state({ session: "signed-in", link: "disconnected" }))).toBe(
      "degraded",
    );
    expect(deriveShellStatus(state({ session: "signed-in", link: "unavailable" }))).toBe(
      "degraded",
    );
  });

  it("lets nothing outrank a stop", () => {
    expect(
      deriveShellStatus(state({ stopped: true, session: "signed-in", fault: "no-printer" })),
    ).toBe("stopped");
  });
});

describe("isWorking", () => {
  it("counts degraded, so a reconnect does not nag anybody", () => {
    expect(isWorking("degraded")).toBe(true);
    expect(isWorking("online")).toBe(true);
  });

  it("excludes every state a person has to act on", () => {
    const actionable = ["starting", "signed-out", "faulted", "stopped"] as const;
    expect(actionable.map(isWorking)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
