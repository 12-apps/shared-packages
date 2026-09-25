import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Handing a person a desktop build to run on their own machine — the
 * installer a download button fetches, and the feed an agent's updater reads.
 *
 * Framework-free at the edges (`Request` in, `Response` out), Node inside: the
 * disk copy is read with `node:fs`. The bucket is the HOST's, behind
 * {@link DesktopStoragePort}, so this package depends on no storage SDK.
 *
 * ## Where the bytes come from
 *
 * - **A local build's copy on disk** is streamed. It is what a developer gets
 *   from a local `electron-builder` run, and it works with no bucket at all.
 * - **The release's copy in the bucket** is handed over as a `302` to a
 *   presigned link that dies in {@link PRESIGNED_TTL_SECONDS} seconds.
 *   Streamed THROUGH the app, a 100 MB installer crawled for minutes on a
 *   small API container and answered no `Range` request. The object stays
 *   private: the link exists only once the host's route has authenticated the
 *   caller, and it is dead before it could be worth passing around.
 * - **The update channel file** (`*.yml`) is streamed, never redirected: it is
 *   a few hundred bytes, and it is the question the route's session check has
 *   to see every time an agent asks "is there a newer build?".
 *
 * Neither place having it is a 404 with the caller's own code, so a screen can
 * tell "no build anywhere" from "wrong URL" and offer its fallback.
 */

/** What a person's machine is, in the only three shapes anything is built for. */
export type DesktopPlatform = "windows" | "macos" | "linux";

/**
 * The host's bucket, narrowed to the three questions asked of it.
 *
 * Each answers "not there" as `false` / `null`. A port that THROWS instead —
 * a bad credential, an unreachable endpoint, a missing key surfaced as an
 * error — reads the same: the package catches it and answers the coded 404,
 * because that is the honest answer when this deploy cannot hand over a file.
 */
export interface DesktopStoragePort {
  /** Whether the object exists — asked BEFORE signing, see {@link serveDesktopAsset}. */
  head(key: string): Promise<boolean>;
  /** A link to the object that lives `ttlSeconds` and saves as `filename`. */
  presign(key: string, filename: string, ttlSeconds: number): Promise<string>;
  /** The object's bytes, streamed. */
  get(key: string): Promise<StoredAsset | null>;
}

/** One file's bytes, from wherever they were found. */
export interface StoredAsset {
  body: ReadableStream;
  size: number | null;
}

/**
 * How long a presigned link lives.
 *
 * Long enough for a browser (or an updater) to START the download after the
 * redirect — the signature is checked when the request starts, so a slow
 * download that began in time finishes — and short enough that a link copied
 * out of the address bar is useless by the time anybody could forward it.
 */
export const PRESIGNED_TTL_SECONDS = 300;

interface StorageSpec {
  /** Where a local build put the files. */
  directory: string;
  /**
   * The bucket "directory" the release uploads these under: keys are
   * `<objectPrefix>/<file>`.
   */
  objectPrefix: string;
  /** The `error.code` of the 404 when neither the disk nor the bucket has the file. */
  missingCode: string;
  /** The host's bucket. Absent: disk only. */
  storage?: DesktopStoragePort | null;
}

export interface DesktopAssetSpec extends StorageSpec {
  /** The file each platform is served, relative to `directory`. */
  assets: Record<DesktopPlatform, string>;
}

export interface NamedDesktopAssetSpec extends StorageSpec {
  /**
   * The file asked for. NOT validated here: it is joined onto a directory and
   * a key prefix as it is, so the caller checks it against its closed set of
   * legal names first — a traversal is the route's to refuse.
   */
  file: string;
}

/**
 * Guess the machine from its own claim about itself.
 *
 * A guess, and it only has to be right often enough to save a click: `asked`
 * (a query parameter, say) overrides it, so somebody downloading for another
 * machine is never stuck. Windows is the fallback.
 */
export function platformFor(userAgent: string | null, asked?: string | null): DesktopPlatform {
  if (asked === "windows" || asked === "macos" || asked === "linux") return asked;
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "windows";
}

/**
 * The installer for the caller's platform: disk first, then a presigned
 * redirect to the bucket, else a 404 carrying `spec.missingCode`.
 *
 * The bucket is asked whether the key EXISTS before a link is signed, because
 * a presigned URL is signed whether or not it does: without the check a
 * missing build would redirect to the bucket's XML error page instead of the
 * coded 404.
 */
export async function serveDesktopAsset(request: Request, spec: DesktopAssetSpec): Promise<Response> {
  const url = new URL(request.url);
  const platform = platformFor(request.headers.get("user-agent"), url.searchParams.get("platform"));
  const asset = spec.assets[platform];

  const found = await fromDisk(join(spec.directory, asset));
  if (!found) {
    const link = await presigned(spec.storage, `${spec.objectPrefix}/${asset}`, asset);
    if (link === null) {
      return Response.json({ error: { code: spec.missingCode, platform } }, { status: 404 });
    }
    return redirect(link);
  }

  return new Response(found.body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      ...sizeHeader(found),
      "content-disposition": `attachment; filename="${asset}"`,
      // It changes only on a release.
      "cache-control": "private, max-age=3600",
    },
  });
}

/**
 * ONE named file, for an updater that already knows what it wants: a channel
 * file, then the artefact that file names, including the `.blockmap` it uses
 * to fetch only the changed bytes.
 *
 * Disk first. Otherwise an installer or blockmap is a presigned redirect (so
 * the updater's `Range` requests reach the bucket), while the channel file is
 * streamed from the bucket. Neither: a 404 carrying `spec.missingCode`.
 */
export async function serveNamedDesktopAsset(spec: NamedDesktopAssetSpec): Promise<Response> {
  const key = `${spec.objectPrefix}/${spec.file}`;
  const onDisk = await fromDisk(join(spec.directory, spec.file));
  if (!onDisk && !isChannelFile(spec.file)) {
    const link = await presigned(spec.storage, key, spec.file);
    if (link !== null) return redirect(link);
  }
  const found = onDisk ?? (await fromBucket(spec.storage, key));

  if (!found) {
    return Response.json({ error: { code: spec.missingCode, file: spec.file } }, { status: 404 });
  }

  return new Response(found.body, {
    status: 200,
    headers: {
      // The updater reads the body either way and never branches on this.
      "content-type": "application/octet-stream",
      ...sizeHeader(found),
      // NEVER cached: an hour-old answer to "is there a newer build?" is an
      // hour of machines on a version a fix was already shipped for.
      "cache-control": "no-store",
    },
  });
}

/** `latest.yml`, `latest-linux.yml`: the small file that names the build. */
function isChannelFile(file: string): boolean {
  return file.endsWith(".yml");
}

function redirect(link: string): Response {
  // `no-store` so a browser never replays a link that has since expired.
  return new Response(null, { status: 302, headers: { location: link, "cache-control": "no-store" } });
}

function sizeHeader(found: StoredAsset): Record<string, string> {
  return found.size === null ? {} : { "content-length": String(found.size) };
}

/** The copy a local build left behind, if there is one. */
async function fromDisk(path: string): Promise<StoredAsset | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { body: Readable.toWeb(createReadStream(path)) as ReadableStream, size: info.size };
  } catch {
    return null;
  }
}

/** The bucket's copy, streamed; any failure of the port reads as "not there". */
async function fromBucket(
  storage: DesktopStoragePort | null | undefined,
  key: string,
): Promise<StoredAsset | null> {
  if (!storage) return null;
  try {
    return await storage.get(key);
  } catch {
    return null;
  }
}

/** A link straight to the bucket's copy, or `null` when there is none. */
async function presigned(
  storage: DesktopStoragePort | null | undefined,
  key: string,
  filename: string,
): Promise<string | null> {
  if (!storage) return null;
  try {
    if (!(await storage.head(key))) return null;
    return await storage.presign(key, filename, PRESIGNED_TTL_SECONDS);
  } catch {
    return null;
  }
}
