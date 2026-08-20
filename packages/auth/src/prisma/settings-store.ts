import type { EmailAuthSettings } from "../email-credentials/types";

/**
 * The two platform switches, over this package's own `auth_platform_settings`.
 *
 * ## Why none of this was ever host code
 *
 * It was a 160-line module in the application, and not one line of it said
 * anything about that application: the keys, the safe defaults, the coercion of
 * a `Json` column into a boolean, the read that must not throw and the write
 * that must. A second host would have written the same file, and the two would
 * have disagreed about what `"true"` means or which way a broken read fails.
 *
 * ## The read tolerates, the write does not
 *
 * A settings read happens on the login screen of every visitor, before anyone
 * is signed in. If the table is missing — a host that has not run the migration
 * yet — the honest answer is the conservative default, not a 500 on the front
 * door. A WRITE is the opposite: an operator who flips a switch must get an
 * error if it did not land, rather than a screen that says "saved" over a value
 * that did not change.
 */

/** The keys, spelled once. They are a contract — rows exist under them. */
export const AUTH_SETTING_KEYS = {
  enabled: "auth.email_password.enabled",
  requireVerification: "auth.email_password.require_verification",
} as const;

/**
 * What to answer with when the setting cannot be read.
 *
 * Also what the migration seeds, so a fresh deployment and a broken read agree.
 * Off + verification-required is the safe half of both trade-offs: the method
 * has to be deliberately turned on, and turning it on cannot accidentally open
 * unverified registration.
 */
export const DEFAULT_AUTH_SETTINGS: EmailAuthSettings = {
  enabled: false,
  requireEmailVerification: true,
};

/** A settings row as this package stores it. */
interface SettingRow {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: Date | null;
}

/** The host client delegate — structural, never generated. See `store.ts`. */
export interface AuthSettingsDb {
  authPlatformSetting: {
    findMany(args: {
      where: { key: { in: string[] } };
    }): Promise<SettingRow[]>;
    upsert(args: {
      where: { key: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export type AuthSettingsDbProvider = () => Promise<AuthSettingsDb>;

/** When each switch was last changed and by whom, for the settings screen. */
export interface AuthSettingsAuditEntry {
  key: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface AuthSettingsStore {
  read(): Promise<EmailAuthSettings>;
  write(changes: Partial<EmailAuthSettings>, updatedBy: string): Promise<EmailAuthSettings>;
  audit(): Promise<AuthSettingsAuditEntry[]>;
}

export interface AuthSettingsStoreConfig {
  getDb: AuthSettingsDbProvider;
  /**
   * Told about a swallowed read failure, so it reaches the host's logger.
   *
   * The package does not pick a logging vendor — a `console.error` here would
   * be invisible to a host whose observability hangs off its own factory.
   */
  onReadError?: (error: unknown) => void;
}

/**
 * Coerce a `Json` column into a boolean, tolerating whatever it might hold.
 *
 * The value could be `true`, `"true"`, `1`, `null`, or an object somebody put
 * there by hand. Validating rather than trusting is the difference between a
 * wrong setting and a login screen that throws.
 */
function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

const KEYS = [AUTH_SETTING_KEYS.enabled, AUTH_SETTING_KEYS.requireVerification];

export function createAuthSettingsStore(config: AuthSettingsStoreConfig): AuthSettingsStore {
  const { getDb, onReadError } = config;

  const read = async (): Promise<EmailAuthSettings> => {
    try {
      const db = await getDb();
      const rows = await db.authPlatformSetting.findMany({ where: { key: { in: KEYS } } });
      const byKey = new Map(rows.map((row) => [row.key, row.value]));
      return {
        enabled: toBoolean(
          byKey.get(AUTH_SETTING_KEYS.enabled),
          DEFAULT_AUTH_SETTINGS.enabled,
        ),
        requireEmailVerification: toBoolean(
          byKey.get(AUTH_SETTING_KEYS.requireVerification),
          DEFAULT_AUTH_SETTINGS.requireEmailVerification,
        ),
      };
    } catch (error) {
      // Deliberately not rethrown: see the module docs. The login screen of a
      // host that has not migrated yet renders, without the e-mail form.
      onReadError?.(error);
      return DEFAULT_AUTH_SETTINGS;
    }
  };

  return {
    read,

    async write(changes, updatedBy) {
      const db = await getDb();
      const writes: { key: string; value: boolean }[] = [];
      if (changes.enabled !== undefined) {
        writes.push({ key: AUTH_SETTING_KEYS.enabled, value: changes.enabled });
      }
      if (changes.requireEmailVerification !== undefined) {
        writes.push({
          key: AUTH_SETTING_KEYS.requireVerification,
          value: changes.requireEmailVerification,
        });
      }
      for (const entry of writes) {
        // Throws on failure, unlike the read.
        await db.authPlatformSetting.upsert({
          where: { key: entry.key },
          update: { value: entry.value, updatedBy },
          create: { key: entry.key, value: entry.value, updatedBy },
        });
      }
      return read();
    },

    async audit() {
      try {
        const db = await getDb();
        const rows = await db.authPlatformSetting.findMany({ where: { key: { in: KEYS } } });
        return rows.map((row) => ({
          key: row.key,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        }));
      } catch (error) {
        // Provenance is not worth breaking a page over.
        onReadError?.(error);
        return [];
      }
    },
  };
}
