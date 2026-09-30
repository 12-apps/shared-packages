import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  platformFor,
  PRESIGNED_TTL_SECONDS,
  serveDesktopAsset,
  serveNamedDesktopAsset,
  type DesktopStoragePort,
} from "../assets";

/**
 * The places a desktop build can be, and the answers.
 *
 * The bucket is a fake {@link DesktopStoragePort}: the real S3 adapter is the
 * host's, and so is the test that drives a real S3 client against a fake
 * endpoint. What is proven here is the ORDER (disk, then bucket), which files
 * are redirected and which streamed, and that no failure of the port can turn
 * a missing build into anything but the coded 404.
 *
 * `fixtures/` holds one committed file, `app.dmg`, so the disk branch runs for
 * real with nothing written; the other two platforms exercise the miss.
 */

const ASSETS = { windows: "app.exe", macos: "app.dmg", linux: "app.AppImage" } as const;
const PREFIX = "desktop/agent";
const DIRECTORY = join(__dirname, "fixtures");

/** A bucket holding these objects, recording what it was asked. */
function bucket(objects: Record<string, string>): DesktopStoragePort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    head: (key) => {
      asked.push(`head ${key}`);
      return Promise.resolve(key in objects);
    },
    presign: (key, filename, ttl) => {
      asked.push(`presign ${key}`);
      return Promise.resolve(`https://bucket.test/${key}?ttl=${ttl}&filename=${filename}`);
    },
    get: (key) => {
      asked.push(`get ${key}`);
      const body = objects[key];
      if (body === undefined) return Promise.resolve(null);
      return Promise.resolve({ body: new Response(body).body as ReadableStream, size: body.length });
    },
  };
}

/** A bucket every call to which fails — a bad credential, an unreachable endpoint. */
const BROKEN: DesktopStoragePort = {
  head: () => Promise.reject(new Error("AccessDenied")),
  presign: () => Promise.reject(new Error("AccessDenied")),
  get: () => Promise.reject(new Error("AccessDenied")),
};

const HELD = bucket({
  [`${PREFIX}/app.dmg`]: "the bucket's copy of the dmg",
  [`${PREFIX}/app.exe`]: "the bucket's only copy",
  [`${PREFIX}/latest.yml`]: "version: 9.9.9",
});

function ask(platform: string): Request {
  return new Request(`https://host.test/download?platform=${platform}`, {
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
}

const spec = (storage: DesktopStoragePort | null = HELD) => ({
  directory: DIRECTORY,
  assets: ASSETS,
  objectPrefix: PREFIX,
  missingCode: "not_built",
  storage,
});

describe("serving a desktop installer", () => {
  it("prefers the file a local build left on disk", async () => {
    // The bucket holds an `app.dmg` too, and a different one: if the order ever
    // flips, those bytes come back and this fails.
    const answer = await serveDesktopAsset(ask("macos"), spec());

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("from the disk");
    expect(answer.headers.get("content-disposition")).toBe('attachment; filename="app.dmg"');
    expect(answer.headers.get("content-length")).toBe("13");
  });

  it("redirects to a short-lived signed link when only the bucket has it", async () => {
    const answer = await serveDesktopAsset(ask("windows"), spec());

    expect(answer.status).toBe(302);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const link = new URL(answer.headers.get("location") ?? "");
    expect(link.pathname).toBe(`/${PREFIX}/app.exe`);
    // Dead in five minutes: long enough to start, too short to pass around.
    expect(link.searchParams.get("ttl")).toBe(String(PRESIGNED_TTL_SECONDS));
    expect(PRESIGNED_TTL_SECONDS).toBe(300);
    expect(link.searchParams.get("filename")).toBe("app.exe");
  });

  it("answers the caller's code when neither the disk nor the bucket has it", async () => {
    // A signed link is signed whether or not the key exists; asking first is
    // what keeps a missing build a coded 404 rather than a redirect to the
    // bucket's error page.
    const storage = bucket({});
    const answer = await serveDesktopAsset(ask("linux"), spec(storage));

    expect(answer.status).toBe(404);
    expect(answer.headers.get("location")).toBeNull();
    expect(await answer.json()).toEqual({ error: { code: "not_built", platform: "linux" } });
    expect(storage.asked).toEqual([`head ${PREFIX}/app.AppImage`]);
  });

  it("answers the coded 404 when the bucket fails, and with no bucket at all", async () => {
    for (const storage of [BROKEN, null]) {
      const answer = await serveDesktopAsset(ask("windows"), spec(storage));

      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ error: { code: "not_built", platform: "windows" } });
    }
  });
});

describe("guessing the machine", () => {
  it("takes the asked platform over the user agent", () => {
    expect(platformFor("Mozilla/5.0 (Macintosh)", "linux")).toBe("linux");
  });

  it("reads macOS and Linux from the user agent, but not Android", () => {
    expect(platformFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
    expect(platformFor("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(platformFor("Mozilla/5.0 (Linux; Android 14)")).toBe("windows");
  });

  it("falls back to Windows", () => {
    expect(platformFor(null)).toBe("windows");
    expect(platformFor(null, "beos")).toBe("windows");
  });
});

describe("serving the update feed", () => {
  const feed = (file: string, storage: DesktopStoragePort | null = HELD) => ({
    directory: DIRECTORY,
    objectPrefix: PREFIX,
    file,
    missingCode: "update_not_built",
    storage,
  });

  it("sends the updater straight to the bucket for the installer", async () => {
    const answer = await serveNamedDesktopAsset(feed("app.exe"));

    expect(answer.status).toBe(302);
    expect(answer.headers.get("location")).toContain(`${PREFIX}/app.exe`);
  });

  it("streams the small channel file itself, never a redirect, never cached", async () => {
    const storage = bucket({ [`${PREFIX}/latest.yml`]: "version: 9.9.9" });
    const answer = await serveNamedDesktopAsset(feed("latest.yml", storage));

    expect(answer.status).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(await answer.text()).toBe("version: 9.9.9");
    expect(storage.asked).toEqual([`get ${PREFIX}/latest.yml`]);
  });

  it("serves the disk's copy before the bucket's", async () => {
    const answer = await serveNamedDesktopAsset(feed("app.dmg"));

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("from the disk");
  });

  it("still answers the coded 404 when the build is not in the bucket", async () => {
    const answer = await serveNamedDesktopAsset(feed("app.AppImage"));

    expect(answer.status).toBe(404);
    expect(await answer.json()).toEqual({
      error: { code: "update_not_built", file: "app.AppImage" },
    });
  });

  it("answers the coded 404 when the bucket fails", async () => {
    for (const file of ["app.exe", "latest.yml"]) {
      const answer = await serveNamedDesktopAsset(feed(file, BROKEN));

      expect(answer.status).toBe(404);
    }
  });
});
