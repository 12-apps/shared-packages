import { describe, expect, it } from "vitest";

import { InvalidRedisUrlError, parseRedisUrl } from "../redis-url";

describe("parseRedisUrl", () => {
  it("defaults host, port and database", () => {
    expect(parseRedisUrl("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
      username: undefined,
      password: undefined,
      db: undefined,
      tls: undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  it("reads credentials, port and database from the URL", () => {
    const parsed = parseRedisUrl("redis://user:p%40ss@redis:6380/3");

    expect(parsed).toMatchObject({
      host: "redis",
      port: 6380,
      username: "user",
      password: "p@ss",
      db: 3,
    });
  });

  it("enables TLS for rediss://", () => {
    expect(parseRedisUrl("rediss://redis:6379").tls).toEqual({});
  });

  it("always pins the two options BullMQ requires", () => {
    const parsed = parseRedisUrl("redis://redis:6379/1");

    expect(parsed.maxRetriesPerRequest).toBeNull();
    expect(parsed.enableReadyCheck).toBe(false);
  });

  it("rejects a non-Redis protocol", () => {
    expect(() => parseRedisUrl("http://redis:6379")).toThrow(InvalidRedisUrlError);
  });

  it("rejects a malformed URL", () => {
    expect(() => parseRedisUrl("not a url")).toThrow(InvalidRedisUrlError);
  });

  it("never puts the URL (which can carry a password) in the error message", () => {
    expect(() => parseRedisUrl("http://user:hunter2@redis:6379")).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("hunter2") as unknown as string,
      }),
    );
  });
});
