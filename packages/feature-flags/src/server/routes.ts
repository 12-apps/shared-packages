/**
 * The six framework-neutral endpoints, mount-relative. Error copy is pt-BR
 * (a user-facing management screen reads it) beside stable machine codes.
 *
 * Grant lookups run `findUnique` first and never rely on the client throwing
 * a known error code for a missing row — the seam is structural, and a fake
 * that faithfully implements the interface must behave identically to the
 * generated client here.
 */

import type { FlagDefinition, GrantView, UserFeatureGrantRow } from "../index";
import type {
  DirectoryUser,
  FeatureFlagsRequest,
  FeatureFlagsResponse,
  FeatureFlagsRoute,
  FeatureFlagsServerConfig,
} from "./context";
import type { FeatureFlagsServerCopy } from "./copy";

const PER_PAGE_DEFAULT = 20;
const PER_PAGE_MAX = 100;
const NOTE_MAX = 500;

function reply(status: number, body: unknown): FeatureFlagsResponse {
  return { status, body };
}

function failure(status: number, error: string, message: string): FeatureFlagsResponse {
  return reply(status, { error, message });
}

function unauthenticated(
  request: FeatureFlagsRequest,
  copy: FeatureFlagsServerCopy,
): FeatureFlagsResponse | null {
  // The host's guard runs long before this; refusing a blank actor here only
  // keeps a miswired bridge from stamping writes with an empty grantedBy.
  if (typeof request.actor?.email !== "string" || request.actor.email.trim() === "") {
    return failure(401, "unauthenticated", copy.unauthenticated);
  }
  return null;
}

function unknownFlag(copy: FeatureFlagsServerCopy): FeatureFlagsResponse {
  return failure(404, "unknown_flag", copy.unknownFlag);
}

function flagOf(
  catalog: readonly FlagDefinition[],
  params: Record<string, string | undefined>,
): FlagDefinition | null {
  const key = params["key"];
  return catalog.find((flag) => flag.key === key) ?? null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function grantView(row: UserFeatureGrantRow, person: DirectoryUser | undefined): GrantView {
  return {
    userId: row.userId,
    email: person?.email ?? null,
    name: person?.name ?? null,
    flagKey: row.flagKey,
    enabled: row.enabled,
    note: row.note,
    grantedBy: row.grantedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function peopleById(
  config: FeatureFlagsServerConfig,
  rows: readonly UserFeatureGrantRow[],
): Promise<Map<string, DirectoryUser>> {
  const ids = [...new Set(rows.map((row) => row.userId))];
  if (ids.length === 0) return new Map();
  const users = await config.directory.getUsers(ids);
  return new Map(users.map((user) => [user.id, user]));
}

interface ParsedNote {
  ok: boolean;
  value?: string | null;
}

/** `undefined` = field absent; `null` = clear it; a string is trimmed + bounded. */
function noteOf(body: Record<string, unknown>): ParsedNote {
  if (!("note" in body)) return { ok: true };
  const raw = body["note"];
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || raw.length > NOTE_MAX) return { ok: false };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function bodyOf(request: FeatureFlagsRequest): Record<string, unknown> | null {
  const body = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

// ─── GET / ───────────────────────────────────────────────────────────────────

export function flagsIndexRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "GET",
    path: "/",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const db = await config.db();
      // One unbounded read, deliberately: grants are a beta cohort, bounded by
      // the humans a superadmin enrolled by hand — not a growth table.
      const rows = await db.userFeatureGrant.findMany({});
      const byKey = new Map<string, { total: number; enabled: number }>();
      for (const row of rows) {
        const tally = byKey.get(row.flagKey) ?? { total: 0, enabled: 0 };
        tally.total += 1;
        if (row.enabled) tally.enabled += 1;
        byKey.set(row.flagKey, tally);
      }
      const known = new Set(config.catalog.map((flag) => flag.key));
      const flags = config.catalog.map((flag) => ({
        key: flag.key,
        label: flag.label,
        description: flag.description ?? null,
        grantCount: byKey.get(flag.key)?.total ?? 0,
        enabledCount: byKey.get(flag.key)?.enabled ?? 0,
      }));
      const orphans = [...byKey.entries()]
        .filter(([key]) => !known.has(key))
        .map(([flagKey, tally]) => ({ flagKey, grantCount: tally.total }))
        .sort((a, b) => a.flagKey.localeCompare(b.flagKey));
      return reply(200, { flags, orphans });
    },
  };
}

// ─── GET /users/:userId ──────────────────────────────────────────────────────

export function userFlagsRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "GET",
    path: "/users/:userId",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const userId = request.params["userId"];
      if (userId === undefined || userId.trim() === "") {
        return failure(422, "invalid_user", config.copy.invalidUser);
      }
      const db = await config.db();
      const rows = await db.userFeatureGrant.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      });
      const people = await peopleById(config, rows);
      const labels = new Map(config.catalog.map((flag) => [flag.key, flag.label]));
      const grants = rows.map((row) => ({
        ...grantView(row, people.get(row.userId)),
        // `null` label marks a retired key — visible, so the orphan can be
        // cleaned up, instead of silently dropped like the reader does.
        label: labels.get(row.flagKey) ?? null,
      }));
      return reply(200, { userId, grants });
    },
  };
}

// ─── GET /:key/grants ────────────────────────────────────────────────────────

export function grantsListRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "GET",
    path: "/:key/grants",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const flag = flagOf(config.catalog, request.params);
      if (!flag) return unknownFlag(config.copy);
      const page = positiveInt(request.query["page"], 1);
      const perPage = Math.min(positiveInt(request.query["perPage"], PER_PAGE_DEFAULT), PER_PAGE_MAX);
      const db = await config.db();
      const [total, rows] = await Promise.all([
        db.userFeatureGrant.count({ where: { flagKey: flag.key } }),
        db.userFeatureGrant.findMany({
          where: { flagKey: flag.key },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * perPage,
          take: perPage,
        }),
      ]);
      const people = await peopleById(config, rows);
      const items = rows.map((row) => grantView(row, people.get(row.userId)));
      return reply(200, { items, page, perPage, total });
    },
  };
}

// ─── POST /:key/grants ───────────────────────────────────────────────────────

interface EmailGrantInput {
  email: string;
  note: string | null | undefined;
}

function parseEmailGrant(
  request: FeatureFlagsRequest,
  copy: FeatureFlagsServerCopy,
): EmailGrantInput | FeatureFlagsResponse {
  const body = bodyOf(request);
  const email = typeof body?.["email"] === "string" ? body["email"].trim() : "";
  if (body === null || !email.includes("@")) {
    return failure(422, "invalid_email", copy.invalidEmail);
  }
  const note = noteOf(body);
  if (!note.ok) return failure(422, "invalid_note", copy.noteTooLong);
  return { email, note: note.value };
}

async function regrant(
  config: FeatureFlagsServerConfig,
  request: FeatureFlagsRequest,
  flagKey: string,
  person: DirectoryUser,
  note: string | null | undefined,
): Promise<{ row: UserFeatureGrantRow; existed: boolean }> {
  const db = await config.db();
  const where = { userId_flagKey: { userId: person.id, flagKey } };
  const existing = await db.userFeatureGrant.findUnique({ where });
  const row = await db.userFeatureGrant.upsert({
    where,
    create: {
      userId: person.id,
      flagKey,
      enabled: true,
      grantedBy: request.actor.email,
      note: note ?? null,
    },
    update: {
      enabled: true,
      grantedBy: request.actor.email,
      ...(note !== undefined ? { note } : {}),
    },
  });
  return { row, existed: existing !== null };
}

export function grantByEmailRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "POST",
    path: "/:key/grants",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const flag = flagOf(config.catalog, request.params);
      if (!flag) return unknownFlag(config.copy);
      const input = parseEmailGrant(request, config.copy);
      if ("status" in input) return input;
      const person = await config.directory.findUserByEmail(input.email);
      if (!person) return failure(404, "user_not_found", config.copy.userNotFound);
      const { row, existed } = await regrant(config, request, flag.key, person, input.note);
      await config.audit?.({
        action: existed ? "updated" : "granted",
        flagKey: flag.key,
        userId: person.id,
        actor: request.actor.email,
      });
      return reply(existed ? 200 : 201, { grant: grantView(row, person) });
    },
  };
}

// ─── PUT /:key/grants/:userId ────────────────────────────────────────────────

interface GrantPatch {
  enabled: boolean | undefined;
  note: string | null | undefined;
}

function parseGrantPatch(
  request: FeatureFlagsRequest,
  copy: FeatureFlagsServerCopy,
): GrantPatch | FeatureFlagsResponse {
  const body = bodyOf(request);
  if (body === null) return failure(422, "invalid_body", copy.invalidBody);
  const enabled = body["enabled"];
  if ("enabled" in body && typeof enabled !== "boolean") {
    return failure(422, "invalid_enabled", copy.invalidEnabled);
  }
  const note = noteOf(body);
  if (!note.ok) return failure(422, "invalid_note", copy.noteTooLong);
  return { enabled: typeof enabled === "boolean" ? enabled : undefined, note: note.value };
}

async function patchGrant(
  config: FeatureFlagsServerConfig,
  request: FeatureFlagsRequest,
  flagKey: string,
  userId: string,
  patch: GrantPatch,
): Promise<UserFeatureGrantRow | null> {
  const db = await config.db();
  const where = { userId_flagKey: { userId, flagKey } };
  // Update-only, never upsert: creation goes through the by-email route,
  // where the id is proven to be a person. A PUT at a typo'd id minting a
  // grant nobody can see in the directory is the footgun this refuses.
  const existing = await db.userFeatureGrant.findUnique({ where });
  if (!existing) return null;
  return db.userFeatureGrant.upsert({
    where,
    create: {
      userId,
      flagKey,
      enabled: patch.enabled ?? existing.enabled,
      grantedBy: request.actor.email,
      note: patch.note ?? existing.note,
    },
    update: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      grantedBy: request.actor.email,
    },
  });
}

export function grantUpdateRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "PUT",
    path: "/:key/grants/:userId",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const flag = flagOf(config.catalog, request.params);
      if (!flag) return unknownFlag(config.copy);
      const patch = parseGrantPatch(request, config.copy);
      if ("status" in patch) return patch;
      const userId = request.params["userId"] ?? "";
      const row = await patchGrant(config, request, flag.key, userId, patch);
      if (row === null) {
        return failure(404, "grant_not_found", config.copy.grantNotFound);
      }
      await config.audit?.({
        action: "updated",
        flagKey: flag.key,
        userId,
        actor: request.actor.email,
      });
      const [person] = await config.directory.getUsers([userId]);
      return reply(200, { grant: grantView(row, person) });
    },
  };
}

// ─── DELETE /:key/grants/:userId ─────────────────────────────────────────────

export function grantRevokeRoute(config: FeatureFlagsServerConfig): FeatureFlagsRoute {
  return {
    method: "DELETE",
    path: "/:key/grants/:userId",
    async handle(request) {
      const denied = unauthenticated(request, config.copy);
      if (denied) return denied;
      const flag = flagOf(config.catalog, request.params);
      if (!flag) return unknownFlag(config.copy);
      const userId = request.params["userId"] ?? "";
      const db = await config.db();
      const where = { userId_flagKey: { userId, flagKey: flag.key } };
      const existing = await db.userFeatureGrant.findUnique({ where });
      if (!existing) {
        return failure(404, "grant_not_found", config.copy.grantNotFound);
      }
      await db.userFeatureGrant.delete({ where });
      await config.audit?.({
        action: "revoked",
        flagKey: flag.key,
        userId,
        actor: request.actor.email,
      });
      return reply(204, undefined);
    },
  };
}
