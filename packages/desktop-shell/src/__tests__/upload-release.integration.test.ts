import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * `desktop-shell-upload-release` as a PROCESS: the exits a workflow step reads,
 * and the one way a bin can silently do nothing — a `main` guard that compares
 * file names, which a symlink named after the command never matches.
 */

const BIN = fileURLToPath(new URL("../../bin/upload-release.mjs", import.meta.url));

/** No bucket variables at all, whatever the machine running the suite has. */
function bare(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ["S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) delete env[name];
  return env;
}

describe("the command", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("refuses to run without a prefix and a file", () => {
    const run = spawnSync(process.execPath, [BIN], { env: bare(), encoding: "utf8" });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage:");
  });

  it("exits 0 with a note when no bucket is configured", () => {
    const run = spawnSync(process.execPath, [BIN, "releases/1.0.0", "setup.exe"], {
      env: bare(),
      encoding: "utf8",
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("No bucket configured");
  });

  it("runs when invoked through a symlink named after the command, as a bin is", () => {
    // Compared by name, `desktop-shell-upload-release` never matches the file
    // and the command would exit 0 having done nothing at all.
    const directory = mkdtempSync(join(tmpdir(), "upload-release-"));
    cleanup.push(directory);
    const link = join(directory, "desktop-shell-upload-release");
    symlinkSync(BIN, link);

    const run = spawnSync(process.execPath, [link], { env: bare(), encoding: "utf8" });

    expect(run.status).toBe(2);
  });
});
