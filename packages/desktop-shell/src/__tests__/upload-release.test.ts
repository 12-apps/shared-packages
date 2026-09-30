import { describe, expect, it } from "vitest";

// @ts-expect-error -- a plain-JS bin, deliberately outside the typed source
import { bucketConfig, planUploads } from "../../bin/upload-release.mjs";

/**
 * Putting a release in the bucket — `desktop-shell-upload-release`.
 *
 * The decisions below are the ones that fail SILENTLY if they are wrong:
 * uploading with half a credential would 403 per file in a step nobody reads,
 * treating an absent blockmap as fatal would turn a healthy build red for a
 * file that platform never produces. The command itself, as a process, is
 * `upload-release.integration.test.ts`.
 */

describe("bucketConfig", () => {
  it("is null when the repository has no secrets, so a fork still builds", () => {
    // Not a failure: whatever serves releases has nothing to serve until
    // somebody sets them, which is a sentence rather than a broken build.
    expect(bucketConfig({})).toBeNull();
  });

  it("is null on HALF a credential, rather than signing with nothing", () => {
    // The shape that would otherwise 403 once per file, deep in a step's log.
    expect(bucketConfig({ S3_BUCKET: "b", AWS_ACCESS_KEY_ID: "k" })).toBeNull();
    expect(bucketConfig({ S3_BUCKET: "b", AWS_SECRET_ACCESS_KEY: "s" })).toBeNull();
    expect(bucketConfig({ AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s" })).toBeNull();
  });

  it("defaults the region, which Spaces ignores and the SDK demands", () => {
    const config = bucketConfig({
      S3_BUCKET: "b",
      AWS_ACCESS_KEY_ID: "k",
      AWS_SECRET_ACCESS_KEY: "s",
    });
    expect(config).toMatchObject({ bucket: "b", region: "us-east-1" });
    // Omitted rather than undefined: an endpoint key with no value sends the
    // SDK to AWS proper instead of Spaces.
    expect(config).not.toHaveProperty("endpoint");
    expect(config).not.toHaveProperty("forcePathStyle");
  });

  it("carries the endpoint and path style when they are asked for", () => {
    expect(
      bucketConfig({
        S3_BUCKET: "b",
        AWS_ACCESS_KEY_ID: "k",
        AWS_SECRET_ACCESS_KEY: "s",
        S3_REGION: "nyc3",
        S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
        S3_FORCE_PATH_STYLE: "1",
      }),
    ).toMatchObject({
      region: "nyc3",
      endpoint: "https://nyc3.digitaloceanspaces.com",
      forcePathStyle: true,
    });
  });
});

describe("planUploads", () => {
  it("skips a file this platform does not produce instead of failing", () => {
    // macOS builds no channel file on purpose, and an AppImage carries its
    // block map inside itself. Treating either as fatal turns a healthy build
    // red for a file that was never meant to exist.
    const present = new Set(["setup.exe", "latest.yml"]);

    expect(planUploads(["setup.exe", "setup.exe.blockmap", "latest.yml"], (f: string) => present.has(f)))
      .toEqual({ uploads: ["setup.exe", "latest.yml"], missing: ["setup.exe.blockmap"] });
  });

  it("keeps the caller's order, so the channel is never uploaded first", () => {
    // The channel file NAMES the installer. Uploaded ahead of it, an agent
    // checking in that window is told about a build it then cannot fetch.
    const order = ["app.AppImage", "app.AppImage.blockmap", "latest-linux.yml"];

    expect(planUploads(order, () => true).uploads).toEqual(order);
  });

  it("reports everything missing when nothing was built", () => {
    expect(planUploads(["a", "b"], () => false)).toEqual({ uploads: [], missing: ["a", "b"] });
  });
});
