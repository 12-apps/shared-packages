/**
 * `REDIS_URL` → the connection options BullMQ hands to ioredis.
 *
 * Parsed here rather than passed through as a string so the two settings a
 * BullMQ deployment cannot get wrong are applied in ONE place:
 *
 *   - `maxRetriesPerRequest: null` — required by BullMQ's blocking commands.
 *     ioredis' default (20) makes a worker throw on a brief Redis blip
 *     instead of waiting it out.
 *   - `enableReadyCheck: false` — the ready check trips on providers that
 *     restrict `INFO`, and BullMQ does not need it.
 */

/** The subset of ioredis options this library sets. */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
  enableReadyCheck: false;
}

/** Raised for a `REDIS_URL` that cannot be used. */
export class InvalidRedisUrlError extends Error {
  constructor(url: string, detail: string) {
    // The URL can carry a password — report the failure, never the value.
    super(`REDIS_URL is not usable (${detail}). Expected redis:// or rediss://.`);
    this.name = "InvalidRedisUrlError";
    void url;
  }
}

function toUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new InvalidRedisUrlError(url, "it is not a valid URL");
  }
}

/** An empty URL component means "not given", not "the empty string". */
function optional(value: string): string | undefined {
  return value === "" ? undefined : decodeURIComponent(value);
}

/** `/0`, `/1`, … selects the database; an empty path means the default. */
function parseDatabase(url: string, pathname: string): number | undefined {
  const path = pathname.replace(/^\//, "");
  if (path === "") return undefined;
  const db = Number(path);
  if (!Number.isInteger(db)) {
    throw new InvalidRedisUrlError(url, "the path is not a database number");
  }
  return db;
}

export function parseRedisUrl(url: string): RedisConnectionOptions {
  const parsed = toUrl(url);
  const secure = parsed.protocol === "rediss:";
  if (!secure && parsed.protocol !== "redis:") {
    throw new InvalidRedisUrlError(url, `unsupported protocol "${parsed.protocol}"`);
  }

  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    username: optional(parsed.username),
    password: optional(parsed.password),
    db: parseDatabase(url, parsed.pathname),
    tls: secure ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
