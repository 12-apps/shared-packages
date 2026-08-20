import { describe, expect, it, vi } from "vitest";

import type { EmailAuthSettings } from "../../email-credentials/types";
import type { EmailAuthRoute } from "../email-routes";
import {
  emailAuthSettingsRoutes,
  type EmailAuthSettingsStore,
} from "../settings-routes";

/**
 * The two OPERATOR endpoints — the switches that turn a sign-in method off for
 * everybody.
 *
 * These assertions were being made in a HOST, against a `route.ts` that only
 * mounts this. That is the wrong place for them twice over: the host was
 * carrying tests for behaviour it does not own, and this package shipped its
 * only WRITE surface with no test of its own — so a change to `patchOf` here
 * was covered by exactly one downstream repo, and only until that repo stopped
 * asserting it.
 *
 * What stays in a host is the GATE: who may call these, and with which status
 * a refusal answers. That is genuinely per-host — see `AuthMountOptions.before`
 * for why it cannot be expressed through `resolveUserId`.
 */

const SETTINGS: EmailAuthSettings = { enabled: true, requireEmailVerification: false };

const AUDIT = [
  { key: "auth.email_password.enabled", updatedBy: "ops@example.test", updatedAt: "2026-01-01T00:00:00.000Z" },
];

function storeStub(overrides: Partial<EmailAuthSettingsStore> = {}): EmailAuthSettingsStore {
  return {
    read: vi.fn(async () => ({ settings: SETTINGS, audit: AUDIT })),
    write: vi.fn(async () => undefined),
    ...overrides,
  };
}

function route(routes: EmailAuthRoute[], method: string): EmailAuthRoute {
  const found = routes.find((entry) => entry.method === method);
  if (!found) throw new Error(`no ${method} among ${routes.length} routes`);
  return found;
}

describe("emailAuthSettingsRoutes", () => {
  describe("GET", () => {
    it("returns the switches with their provenance", async () => {
      // The audit rows travel WITH the settings rather than behind a second
      // call: the console renders "changed by <who>, <when>" beside each
      // toggle, and a screen that had to make two requests would render one
      // half of that sentence first.
      const routes = emailAuthSettingsRoutes({ store: storeStub() });

      const result = await route(routes, "GET").handle({ body: undefined, userId: "ops@example.test" });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ data: { settings: SETTINGS, audit: AUDIT } });
    });

    it("needs a session, so an anonymous caller never reaches the store", async () => {
      // `session: true` is what makes the mount answer 401 BEFORE `handle`
      // runs. These two endpoints are the ones worth being sure about.
      const routes = emailAuthSettingsRoutes({ store: storeStub() });

      expect(route(routes, "GET").session).toBe(true);
      expect(route(routes, "PUT").session).toBe(true);
    });
  });

  describe("PUT", () => {
    it("writes only the key given — the PUT is a PATCH", async () => {
      // The two toggles move independently. A PUT that replaced the whole
      // object would mean flipping verification also rewrites `enabled` to
      // whatever the screen last read, which is how one operator's stale tab
      // silently turns a sign-in method back on.
      const store = storeStub();
      const routes = emailAuthSettingsRoutes({ store });

      await route(routes, "PUT").handle({
        body: { requireEmailVerification: true },
        userId: "ops@example.test",
      });

      expect(store.write).toHaveBeenCalledWith(
        { requireEmailVerification: true },
        "ops@example.test",
      );
    });

    it("400s an empty body rather than writing nothing and reporting success", async () => {
      // A no-op write that answers 200 is indistinguishable from a real one,
      // so a screen sending the wrong field name would show "saved" forever.
      const store = storeStub();
      const routes = emailAuthSettingsRoutes({ store });

      const result = await route(routes, "PUT").handle({ body: {}, userId: "ops@example.test" });

      expect(result.status).toBe(400);
      expect(store.write).not.toHaveBeenCalled();
    });

    it("400s a non-boolean value", async () => {
      // Including the string "true", which is what a form posts when somebody
      // wires a text input to a switch. Coercing it would make the failure
      // land in the database instead of in the response.
      const store = storeStub();
      const routes = emailAuthSettingsRoutes({ store });

      const result = await route(routes, "PUT").handle({
        body: { enabled: "true" },
        userId: "ops@example.test",
      });

      expect(result.status).toBe(400);
      expect(store.write).not.toHaveBeenCalled();
    });

    it("ignores an unknown key alongside a known one, rather than refusing the write", async () => {
      // A newer console sending a switch this version does not have must not
      // fail the switch it does have — the two halves of a rolling deploy talk
      // to each other for as long as the rollout takes.
      const store = storeStub();
      const routes = emailAuthSettingsRoutes({ store });

      const result = await route(routes, "PUT").handle({
        body: { enabled: false, somethingNewer: true },
        userId: "ops@example.test",
      });

      expect(result.status).toBe(200);
      expect(store.write).toHaveBeenCalledWith({ enabled: false }, "ops@example.test");
    });

    it("answers with the settings read back AFTER the write", async () => {
      // Not with the patch it was handed. The store is the authority — it may
      // clamp, and the console must render what is now true rather than what
      // was asked for. The read-back below reports a SECOND field the patch
      // never mentioned, so a route echoing its input would drop it.
      const read = vi.fn(async () => ({
        settings: { enabled: false, requireEmailVerification: true },
        audit: AUDIT,
      }));
      const routes = emailAuthSettingsRoutes({ store: storeStub({ read }) });

      const result = await route(routes, "PUT").handle({
        body: { enabled: false },
        userId: "ops@example.test",
      });

      expect(result.body).toEqual({
        data: { settings: { enabled: false, requireEmailVerification: true }, audit: AUDIT },
      });
    });
  });
});
