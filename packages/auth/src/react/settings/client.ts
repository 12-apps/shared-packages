import type { EmailAuthSettings } from "../../email-credentials/types";

/** When a switch last moved, and who moved it. */
export interface EmailAuthSettingsAudit {
  key: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface EmailAuthSettingsSnapshot {
  settings: EmailAuthSettings;
  audit: EmailAuthSettingsAudit[];
}

/** Only the keys present are written, so the two switches move independently. */
export type EmailAuthSettingsPatch = Partial<EmailAuthSettings>;

/**
 * How the screen talks to the platform endpoints.
 *
 * An interface rather than a baked-in `fetch` because the host owns the path,
 * the credentials and the envelope its API answers with. `createEmailAuthSettingsClient`
 * below is the one for a host that mounted this package's own router.
 */
export interface EmailAuthSettingsClient {
  read(): Promise<EmailAuthSettingsSnapshot>;
  save(patch: EmailAuthSettingsPatch): Promise<EmailAuthSettingsSnapshot>;
}

/**
 * The default client, for a host that mounted `emailAuthSettingsRouter`.
 *
 * `fetchImpl` is resolved per CALL, never captured — a host builds this at
 * module scope, so capturing would freeze whatever `globalThis.fetch` was at
 * import time, ahead of any test stub. That mistake cost a day; see
 * `createWebAuth`.
 */
export function createEmailAuthSettingsClient(config: {
  basePath?: string;
  fetchImpl?: typeof fetch;
}): EmailAuthSettingsClient {
  const basePath = config.basePath ?? "/api/platform/auth-settings";
  const doFetch: typeof fetch = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  async function call(init?: RequestInit): Promise<EmailAuthSettingsSnapshot> {
    const response = await doFetch(basePath, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!response.ok) throw new Error(`${basePath} answered ${response.status}`);
    const payload = (await response.json()) as { data: EmailAuthSettingsSnapshot };
    return payload.data;
  }

  return {
    read: () => call(),
    // The OBJECT is serialised here, once. A caller passing a pre-stringified
    // body would have it encoded twice and the route's schema would refuse it —
    // which is exactly the bug the super-admin screen shipped with.
    save: (patch) => call({ method: "PUT", body: JSON.stringify(patch) }),
  };
}
