import { describe, expect, it } from "vitest";

import { updateBanner, type UpdateBannerCopy } from "../update-banner";

const COPY: UpdateBannerCopy = {
  downloading: (version, percent) => `down ${version} ${percent ?? "-"}`,
  ready: (version) => `ready ${version}`,
  install: "install now",
  restartHint: "restarts",
};

describe("updateBanner", () => {
  it("offers the restart when a version is on disk", () => {
    expect(updateBanner({ kind: "ready", version: "1.2.0" }, COPY)).toEqual({
      text: "ready 1.2.0",
      action: "install now",
      hint: "restarts",
    });
  });

  it("says a version is downloading, with nothing to press yet", () => {
    expect(updateBanner({ kind: "downloading", version: "1.2.0", percent: 40 }, COPY)).toEqual({
      text: "down 1.2.0 40",
      action: null,
      hint: null,
    });
  });

  it.each(["idle", "unsupported", "off", "checking", "none", "failed"] as const)(
    "shows nothing when the updater is %s",
    (kind) => {
      expect(updateBanner({ kind }, COPY)).toBeNull();
    },
  );
});
