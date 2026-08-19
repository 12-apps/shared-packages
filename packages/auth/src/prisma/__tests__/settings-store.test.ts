import { describe, expect, it, vi } from "vitest";

import {
  AUTH_SETTING_KEYS,
  DEFAULT_AUTH_SETTINGS,
  createAuthSettingsStore,
  type AuthSettingsDb,
} from "../settings-store";

/**
 * These assertions came WITH the code. They were a 152-line test file in a host,
 * covering a 160-line module that said nothing about that host; moving the
 * module here without them would have left the shared implementation less
 * covered than the copy it replaced.
 */

function db(rows: { key: string; value: unknown; updatedBy?: string | null; updatedAt?: Date | null }[]): {
  db: AuthSettingsDb;
  upserts: { where: { key: string }; update: Record<string, unknown> }[];
} {
  const upserts: { where: { key: string }; update: Record<string, unknown> }[] = [];
  return {
    upserts,
    db: {
      authPlatformSetting: {
        findMany: async () =>
          rows.map((row) => ({
            key: row.key,
            value: row.value,
            updatedBy: row.updatedBy ?? null,
            updatedAt: row.updatedAt ?? null,
          })),
        upsert: async (args) => {
          upserts.push({ where: args.where, update: args.update });
          return null;
        },
      },
    },
  };
}

const failing: AuthSettingsDb = {
  authPlatformSetting: {
    findMany: async () => {
      throw new Error("relation \"auth_platform_settings\" does not exist");
    },
    upsert: async () => {
      throw new Error("relation \"auth_platform_settings\" does not exist");
    },
  },
};

describe("createAuthSettingsStore", () => {
  describe("read", () => {
    it("coerces whatever the Json column actually holds", async () => {
      // The column is Json, so the value could be a real boolean, a string, or
      // a number. Validating rather than trusting is the difference between a
      // wrong setting and a login screen that throws.
      for (const [stored, expected] of [
        [true, true],
        ["true", true],
        [1, true],
        [false, false],
        ["false", false],
        [0, false],
      ] as const) {
        const { db: client } = db([{ key: AUTH_SETTING_KEYS.enabled, value: stored }]);
        const store = createAuthSettingsStore({ getDb: async () => client });
        expect((await store.read()).enabled, `stored ${JSON.stringify(stored)}`).toBe(expected);
      }
    });

    it("falls back to the safe default for a value nobody can read", async () => {
      const { db: client } = db([{ key: AUTH_SETTING_KEYS.enabled, value: { nonsense: 1 } }]);
      const store = createAuthSettingsStore({ getDb: async () => client });

      expect((await store.read()).enabled).toBe(DEFAULT_AUTH_SETTINGS.enabled);
    });

    it("answers the conservative default when the table is not there, without throwing", async () => {
      // A settings read happens on the login screen of every visitor, before
      // anyone is signed in. A host that has not run the migration yet gets a
      // front door, not a 500.
      const onReadError = vi.fn();
      const store = createAuthSettingsStore({ getDb: async () => failing, onReadError });

      expect(await store.read()).toEqual(DEFAULT_AUTH_SETTINGS);
      expect(onReadError).toHaveBeenCalledOnce();
    });

    it("falls back to the safe default for a row that is simply not there", async () => {
      // A host that has the table but has never written a switch. Distinct from
      // the unreadable-value case above and from the missing-table one below.
      const { db: client } = db([]);
      const store = createAuthSettingsStore({ getDb: async () => client });

      expect(await store.read()).toEqual(DEFAULT_AUTH_SETTINGS);
    });

    it("defaults to OFF with verification REQUIRED — the safe half of both switches", async () => {
      expect(DEFAULT_AUTH_SETTINGS).toEqual({ enabled: false, requireEmailVerification: true });
    });
  });

  describe("write", () => {
    it("writes only the keys the caller actually named", async () => {
      const { db: client, upserts } = db([]);
      const store = createAuthSettingsStore({ getDb: async () => client });

      await store.write({ enabled: true }, "boss@e.co");

      expect(upserts).toMatchObject([
        { where: { key: AUTH_SETTING_KEYS.enabled }, update: { value: true, updatedBy: "boss@e.co" } },
      ]);
    });

    it("answers with the state as RE-READ, not as requested", async () => {
      // The caller is told what is actually stored. A write that returned its
      // own argument would report success for a value the database rejected or
      // coerced, and the settings screen would render a lie.
      const { db: client } = db([{ key: AUTH_SETTING_KEYS.enabled, value: false }]);
      const store = createAuthSettingsStore({ getDb: async () => client });

      // The stub's findMany still answers `false`, so the re-read disagrees
      // with the request — which is exactly what must surface.
      expect(await store.write({ enabled: true }, "boss@e.co")).toEqual({
        enabled: false,
        requireEmailVerification: true,
      });
    });

    it("THROWS when the write fails, unlike the read", async () => {
      // The asymmetry is the point: an operator who flips a switch must get an
      // error if it did not land, rather than a screen that says "saved" over a
      // value that did not change.
      const store = createAuthSettingsStore({ getDb: async () => failing });

      await expect(store.write({ enabled: true }, "boss@e.co")).rejects.toThrow();
    });
  });

  describe("audit", () => {
    it("reports who last changed each switch, as an ISO string", async () => {
      const when = new Date("2026-08-19T12:00:00.000Z");
      const { db: client } = db([
        { key: AUTH_SETTING_KEYS.enabled, value: true, updatedBy: "boss@e.co", updatedAt: when },
      ]);
      const store = createAuthSettingsStore({ getDb: async () => client });

      expect(await store.audit()).toEqual([
        { key: AUTH_SETTING_KEYS.enabled, updatedBy: "boss@e.co", updatedAt: when.toISOString() },
      ]);
    });

    it("answers with nothing rather than breaking the page it decorates", async () => {
      const store = createAuthSettingsStore({ getDb: async () => failing });

      expect(await store.audit()).toEqual([]);
    });
  });
});
