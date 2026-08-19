import type { EmailAuthSettings } from "../email-credentials/types";

import type { EmailAuthRequest, EmailAuthResponse, EmailAuthRoute } from "./email-routes";

/**
 * The two platform switches, as the console reads and writes them.
 *
 * Separate from `emailAuthRoutes` on purpose, and mounted at a different path:
 * those are the endpoints a SHOPPER's browser calls, these are the ones a
 * platform operator's console calls. Folding them together would put a
 * "turn verification off for everybody" handler behind the same gate as
 * "reset my password", which is the kind of mistake that only shows up once.
 */

/** Where the switches live. The host owns the storage; this is the shape. */
export interface EmailAuthSettingsStore {
  read(): Promise<{
    settings: EmailAuthSettings;
    audit: { key: string; updatedBy: string | null; updatedAt: string | null }[];
  }>;
  /** Only the keys present are written, so the two switches move independently. */
  write(
    changes: Partial<EmailAuthSettings>,
    updatedBy: string,
  ): Promise<void>;
}

export interface EmailAuthSettingsRoutesConfig {
  store: EmailAuthSettingsStore;
  /** Refused when this answers a message; the host decides who may operate. */
  refuseUnlessOperator?: string;
}

function ok(data: unknown): EmailAuthResponse {
  return { status: 200, body: { data } };
}

function patchOf(body: unknown): Partial<EmailAuthSettings> {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const patch: Partial<EmailAuthSettings> = {};
  if (typeof fields.enabled === "boolean") patch.enabled = fields.enabled;
  if (typeof fields.requireEmailVerification === "boolean") {
    patch.requireEmailVerification = fields.requireEmailVerification;
  }
  return patch;
}

/**
 * Build the two descriptors.
 *
 * Both are session-gated; WHICH sessions may operate the platform is the host's
 * call and is enforced by its `resolveUserId` (or a guard in front of the
 * mount). This package refuses to guess at an authorization model.
 */
export function emailAuthSettingsRoutes(config: EmailAuthSettingsRoutesConfig): EmailAuthRoute[] {
  const { store } = config;

  return [
    {
      method: "GET",
      path: "/",
      session: true,
      handle: async (): Promise<EmailAuthResponse> => ok(await store.read()),
    },
    {
      method: "PUT",
      path: "/",
      session: true,
      handle: async ({ body, userId }: EmailAuthRequest): Promise<EmailAuthResponse> => {
        const patch = patchOf(body);
        if (Object.keys(patch).length === 0) {
          // A no-key write is a caller bug, not a silent success: answering 200
          // here would let a screen believe it saved something it never sent —
          // which is how a double-encoded body went unnoticed for a day.
          return { status: 400, body: { error: "no settings given" } };
        }
        await store.write(patch, userId as string);
        return ok(await store.read());
      },
    },
  ];
}
