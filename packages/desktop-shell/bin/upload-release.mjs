#!/usr/bin/env node
/* global console, process */
// ---------------------------------------------------------------------------
// desktop-shell-upload-release — put a release's files in an S3-compatible
// bucket, with no `aws` binary.
//
// Why a script and not `aws s3 cp`: a self-hosted runner with no AWS CLI
// dies with `aws: command not found`, and in a build matrix where the hosted
// runners DO carry it, two thirds of the platforms upload, one never does, and
// the job stays green beside it. Node is already set up in any job that just
// built an Electron app, so this needs nothing installed and behaves the same
// on every runner. A system binary that one runner happens to carry is exactly
// the dependency that breaks when the pool is rebuilt.
//
// `@aws-sdk/client-s3` is an OPTIONAL peer of this package — a host that
// publishes releases adds it as a devDependency; one that does not never
// downloads it. It is imported only once there is something to upload.
//
// Usage: desktop-shell-upload-release <key-prefix> <file>...
//
// Configuration, from the environment:
//   S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   required, or nothing
//                                                         is uploaded (exit 0)
//   S3_REGION             default us-east-1
//   S3_ENDPOINT           for a non-AWS provider (Spaces, R2, MinIO)
//   S3_FORCE_PATH_STYLE   "1" for path-style addressing
//
// A file that does not exist is REPORTED and skipped, never fatal: a block
// map and a channel file are produced per platform, and not every platform
// produces both.
// ---------------------------------------------------------------------------
import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bucket's connection details, or `null` when this repository has none.
 *
 * `null` is not a failure. A fork, and any repository the secrets were never
 * given, must still build and publish its workflow artifact — whatever serves
 * the release simply has nothing to serve until somebody sets them, which is a
 * sentence rather than a broken build. HALF a credential is `null` too: it
 * would otherwise 403 once per file, deep in a step nobody reads.
 */
export function bucketConfig(env) {
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region: env.S3_REGION || "us-east-1",
    // Omitted rather than undefined: an endpoint key with no value sends the
    // SDK to AWS proper instead of the provider asked for.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // Opt-in: most S3-compatible providers are happy with virtual-host style.
    ...(env.S3_FORCE_PATH_STYLE === "1" ? { forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey },
  };
}

/**
 * Split the candidates into what is on disk and what is not, in the caller's
 * order.
 *
 * Absence is expected and meaningful: an AppImage carries its block map inside
 * itself rather than beside it, and a platform the updater does not serve
 * builds no channel file at all. The caller reports the misses so a genuinely
 * missing artefact is visible in the log instead of being inferred from a
 * short upload list. Order matters because a channel file NAMES the installer:
 * uploaded ahead of it, an agent checking in that window is told about a build
 * it then cannot fetch.
 */
export function planUploads(candidates, exists) {
  const uploads = [];
  const missing = [];
  for (const file of candidates) (exists(file) ? uploads : missing).push(file);
  return { uploads, missing };
}

/** `true` when the path is a readable file. */
async function onDisk(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The files as a plan, with the misses already reported. */
async function plan(files) {
  // A SET rather than a parallel array indexed by `indexOf`: the same name can
  // legitimately appear twice on the command line, and `indexOf` would then
  // answer for the first one both times.
  const present = new Set();
  await Promise.all(
    files.map(async (file) => {
      if (await onDisk(file)) present.add(file);
    }),
  );
  const planned = planUploads(files, (file) => present.has(file));
  for (const file of planned.missing) console.log(`not produced by this platform, skipped: ${file}`);
  return planned.uploads;
}

async function upload(config, prefix, uploads) {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3").catch(() => {
    throw new Error("@aws-sdk/client-s3 is not installed — add it as a devDependency of the app that publishes");
  });
  const client = new S3Client({
    ...config,
    // Belt and braces against `aws-chunked` signing, which frames the body in
    // per-chunk headers and lands in the bucket LARGER than the file on disk —
    // measured at +15,605 bytes on a 90 MB installer, which makes an updater
    // read a size disagreeing with the channel file's and refuse the download.
    // The BUFFER below is what actually prevents it; this is here so a later
    // edit that reaches for a stream does not silently reintroduce the framing.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  for (const file of uploads) {
    const key = `${prefix}/${basename(file)}`;
    // A BUFFER, never a stream. This is the line that keeps the object the same
    // size as the file: the SDK reaches for chunked transfer encoding when it
    // cannot know the length up front, and a stream is exactly that case.
    const body = await readFile(file);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        // Whatever serves these sets its own content type.
        ContentType: "application/octet-stream",
        // An installer anybody can fetch by URL is a thing to point malware
        // at: the host serves it through its own gated route, never directly.
        ACL: "private",
      }),
    );
    console.log(`uploaded ${key} (${body.byteLength} bytes)`);
  }
}

async function main() {
  const [prefix, ...files] = process.argv.slice(2);
  if (!prefix || files.length === 0) {
    console.error("usage: desktop-shell-upload-release <key-prefix> <file>...");
    process.exit(2);
  }

  const config = bucketConfig(process.env);
  if (config === null) {
    console.log(
      "::warning::No bucket configured - nothing uploaded. Set S3_BUCKET, " +
        "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to publish releases.",
    );
    return;
  }

  await upload(config, prefix, await plan(files));
}

/**
 * Only when run, so the tests can import the pure functions above. By REAL
 * path: installed as a bin, `argv[1]` is a symlink or shim named after the
 * command, not this file.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
