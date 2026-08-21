import { describe, expect, it, vi } from "vitest";
import { PT_BR_MAIL } from "../../server/mail-templates.pt-BR";

import type { EmailDriver } from "@12-apps/notifications/server";

import { createEnvAuthMailer, resolveAppOrigin, type AuthMailerLog } from "../env-mailer";

/**
 * The driver-resolution TREE — thirty lines every host wrote identically, and
 * every one of whose branches is a security property rather than a preference.
 *
 * The environment is passed in through `read` rather than mutated on
 * `process.env`: a mailer resolves per send, so a test that patched the real
 * environment would leak into whatever ran next in the same worker.
 */

const NAMES = {
  provider: "MAIL_PROVIDER",
  apiKey: "MAIL_KEY",
  from: "MAIL_FROM",
  sinkFile: "MAIL_SINK",
  origin: ["APP_PUBLIC_URL", "AUTH_URL"],
} as const;

function logStub(): AuthMailerLog & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), error: vi.fn() };
}

/** A vendor table with one entry, recording what it was asked to send. */
function vendorTable(): {
  drivers: Record<string, (d: { channel: "EMAIL"; driver: string; apiKey: string; from: string }) => EmailDriver>;
  sent: { to: string; subject: string }[];
  built: { apiKey: string; from: string }[];
} {
  const sent: { to: string; subject: string }[] = [];
  const built: { apiKey: string; from: string }[] = [];
  return {
    sent,
    built,
    drivers: {
      resend: (declaration) => {
        built.push({ apiKey: declaration.apiKey, from: declaration.from });
        return {
          send: (to, message) => {
            sent.push({ to, subject: message.subject });
            return Promise.resolve();
          },
        };
      },
    },
  };
}

const MESSAGE = {
  to: "shopper@example.test",
  name: "Ana",
  link: "https://shop.example.test/verify?token=abc",
  token: "abc",
  expiresAt: new Date("2026-01-01T02:00:00.000Z"),
};

describe("createEnvAuthMailer", () => {
  it("sends through the named vendor when it is fully configured", async () => {
    const vendor = vendorTable();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendor.drivers,
      log: logStub(),
      read: (name) =>
        ({ MAIL_PROVIDER: "resend", MAIL_KEY: "k", MAIL_FROM: "no-reply@example.test" })[name],
    });

    await mailer.sendVerification(MESSAGE);

    expect(vendor.sent).toHaveLength(1);
    expect(vendor.sent[0]?.to).toBe("shopper@example.test");
    expect(vendor.built[0]).toEqual({ apiKey: "k", from: "no-reply@example.test" });
  });

  it("uses the sink when the provider is `log`, without needing a key", async () => {
    // Dev and e2e. A sink that demanded a vendor key would make "run the
    // journeys" require a secret nobody should need to hold.
    const log = logStub();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendorTable().drivers,
      log,
      read: (name) => ({ MAIL_PROVIDER: "log" })[name],
    });

    await mailer.sendPasswordReset(MESSAGE);

    expect(log.info).toHaveBeenCalledWith(
      "auth email (log driver)",
      expect.objectContaining({ to: "shopper@example.test" }),
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it("REFUSES and says so when no provider is configured", async () => {
    // The branch that matters most. A deployment with no mailer must send
    // nothing and record an error: writing a reset link into a log aggregator
    // is worse than not sending it, because the link still works and now has
    // an audience.
    const vendor = vendorTable();
    const log = logStub();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendor.drivers,
      log,
      read: () => undefined,
    });

    await mailer.sendPasswordReset(MESSAGE);

    expect(vendor.sent).toHaveLength(0);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("NOT sent"),
      expect.objectContaining({ to: "shopper@example.test", driver: "(unset)" }),
    );
  });

  it("refuses a configured vendor that is missing its key, rather than half-sending", async () => {
    const vendor = vendorTable();
    const log = logStub();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendor.drivers,
      log,
      read: (name) => ({ MAIL_PROVIDER: "resend", MAIL_FROM: "no-reply@example.test" })[name],
    });

    await mailer.sendVerification(MESSAGE);

    expect(vendor.sent).toHaveLength(0);
    expect(vendor.built).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
  });

  it("refuses an unknown vendor name rather than throwing", async () => {
    // A typo in a deploy variable must not take the sign-in flow down at
    // import. The refusal logs the name it could not resolve, which is the
    // thing an operator needs to see.
    const log = logStub();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendorTable().drivers,
      log,
      read: (name) =>
        ({ MAIL_PROVIDER: "resned", MAIL_KEY: "k", MAIL_FROM: "no-reply@example.test" })[name],
    });

    await expect(mailer.sendVerification(MESSAGE)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ driver: "resned" }),
    );
  });

  it("re-reads the environment on every send", async () => {
    // A preview box is reconfigured under a running process. A driver captured
    // at import keeps sending through whatever was set when the module loaded,
    // which reads as "the new secret did not take".
    const vendor = vendorTable();
    const env: Record<string, string> = { MAIL_PROVIDER: "log" };
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendor.drivers,
      log: logStub(),
      read: (name) => env[name],
    });

    await mailer.sendVerification(MESSAGE);
    expect(vendor.sent).toHaveLength(0);

    env.MAIL_PROVIDER = "resend";
    env.MAIL_KEY = "k";
    env.MAIL_FROM = "no-reply@example.test";
    await mailer.sendVerification(MESSAGE);

    expect(vendor.sent).toHaveLength(1);
  });

  it("points the password-changed notice at the first origin variable that is set", async () => {
    const vendor = vendorTable();
    const mailer = createEnvAuthMailer({
      pack: PT_BR_MAIL,
      env: NAMES,
      drivers: vendor.drivers,
      log: logStub(),
      read: (name) =>
        ({
          MAIL_PROVIDER: "resend",
          MAIL_KEY: "k",
          MAIL_FROM: "no-reply@example.test",
          AUTH_URL: "https://api.example.test",
          APP_PUBLIC_URL: "https://shop.example.test",
        })[name],
    });

    await mailer.sendPasswordChanged?.(MESSAGE);

    // Delivered at all is the assertion that matters here — the origin choice
    // itself is `resolveAppOrigin`'s, tested below against both orders.
    expect(vendor.sent).toHaveLength(1);
  });
});

describe("resolveAppOrigin", () => {
  it("prefers the first name in the list", () => {
    // The order is the host's decision and it is load-bearing: under e2e
    // `AUTH_URL` is the API origin while the storefront is a separate server,
    // so a link built against it points at a host with no pages.
    expect(
      resolveAppOrigin({
        names: ["APP_PUBLIC_URL", "AUTH_URL"],
        read: (name) =>
          ({ APP_PUBLIC_URL: "https://shop.example.test", AUTH_URL: "https://api.example.test" })[name],
      }),
    ).toBe("https://shop.example.test");
  });

  it("falls through to a later name when the first is unset", () => {
    expect(
      resolveAppOrigin({
        names: ["APP_PUBLIC_URL", "AUTH_URL"],
        read: (name) => ({ AUTH_URL: "https://api.example.test" })[name],
      }),
    ).toBe("https://api.example.test");
  });

  it("skips a name set to the empty string", () => {
    // A variable declared and left blank is the common shape of an unset one
    // in a compose file, and treating it as configured produces links with no
    // origin at all.
    expect(
      resolveAppOrigin({
        names: ["APP_PUBLIC_URL", "AUTH_URL"],
        read: (name) => ({ APP_PUBLIC_URL: "", AUTH_URL: "https://api.example.test" })[name],
      }),
    ).toBe("https://api.example.test");
  });

  it("falls back to the development origin when nothing is named", () => {
    expect(resolveAppOrigin({ names: [], read: () => undefined })).toBe("http://localhost:3000");
  });
});
