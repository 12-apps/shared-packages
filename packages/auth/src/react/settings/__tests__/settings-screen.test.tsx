import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PT_BR_SETTINGS } from "../pt-BR";
import {
  createEmailAuthSettingsScreen,
  type EmailAuthSettingsSnapshot,
} from "../index";

/**
 * The operator console for the two platform switches.
 *
 * The DEPENDENCY between them is the behaviour worth protecting and it is not
 * obvious from either toggle alone: verification is inert while the method is
 * off, because a preference stored then changes nothing until somebody else
 * turns the method on — and an operator who set it would reasonably believe
 * they had.
 *
 * These assertions were being made in a HOST, against a page that is ten lines
 * of configuration. The screen is this package's, so the coverage is too.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const BOTH_OFF: EmailAuthSettingsSnapshot = {
  settings: { enabled: false, requireEmailVerification: false },
  audit: [],
};

const METHOD_ON: EmailAuthSettingsSnapshot = {
  settings: { enabled: true, requireEmailVerification: false },
  audit: [],
};

/**
 * A screen over a scripted client: `read` answers the first snapshot, and each
 * `save` answers the next one — which is how the screen is built to work. It
 * writes the SERVER's reply back rather than an optimistic guess, so a test
 * that returned the same snapshot from `save` would assert nothing about the
 * dependency between the two switches.
 */
function screenFor(
  first: EmailAuthSettingsSnapshot,
  ...after: EmailAuthSettingsSnapshot[]
): { Screen: () => JSX.Element; save: ReturnType<typeof vi.fn> } {
  const queue = [...after];
  const save = vi.fn(async () => queue.shift() ?? first);
  const Screen = createEmailAuthSettingsScreen({
    client: { read: async () => first, save },
    copy: PT_BR_SETTINGS,
    formatWhen: (iso) => iso,
  });
  return { Screen, save };
}

describe("createEmailAuthSettingsScreen", () => {
  it("holds verification inert while the method is off, and says why", async () => {
    const { Screen } = screenFor(BOTH_OFF);
    render(<Screen />);

    const verification = await screen.findByTestId("toggle-require-verification");

    // Disabled AND explained. A control that is merely greyed out reads as a
    // bug; the note is what turns it into a stated dependency.
    await waitFor(() => {
      expect(verification.querySelector("input")?.disabled).toBe(true);
    });
    expect(screen.getByText(PT_BR_SETTINGS.verificationInertNote)).toBeTruthy();
  });

  it("releases the verification switch once the server confirms the method is on", async () => {
    // On the SERVER's answer, not on the click. The switch that governs
    // whether the other one means anything must not appear to have moved until
    // the write landed — otherwise a failed save leaves the console showing a
    // platform state that is not true.
    const { Screen } = screenFor(BOTH_OFF, METHOD_ON);
    render(<Screen />);

    const method = await screen.findByTestId("toggle-email-password");
    fireEvent.click(method.querySelector("input")!);

    await waitFor(() => {
      const verification = screen.getByTestId("toggle-require-verification");
      expect(verification.querySelector("input")?.disabled).toBe(false);
    });
    await waitFor(() => {
      expect(screen.queryByText(PT_BR_SETTINGS.verificationInertNote)).toBeNull();
    });
  });

  it("sends only the switch that moved", async () => {
    // The PATCH semantics, from the screen's side. Sending both would mean one
    // operator's stale tab rewrites the switch they did not touch.
    const { Screen, save } = screenFor(METHOD_ON);
    render(<Screen />);

    const verification = await screen.findByTestId("toggle-require-verification");
    fireEvent.click(verification.querySelector("input")!);

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ requireEmailVerification: true });
    });
  });

  it("reports a failed save rather than leaving the toggle where the click put it", async () => {
    const Screen = createEmailAuthSettingsScreen({
      client: {
        read: async () => METHOD_ON,
        save: async () => {
          throw new Error("the write was refused");
        },
      },
      copy: PT_BR_SETTINGS,
      formatWhen: (iso) => iso,
    });
    render(<Screen />);

    const verification = await screen.findByTestId("toggle-require-verification");
    fireEvent.click(verification.querySelector("input")!);

    await waitFor(() => {
      expect(screen.getByTestId("auth-settings-error")).toBeTruthy();
    });
  });
});
