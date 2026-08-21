// Hand cd.yml the PUBLISH_DIRS list that lives in ci.yml — the one copy.
//
// #351 split publishing out of ci.yml into cd.yml, and the release scripts'
// package list stayed behind: ci.yml declares it workflow-level (its consumer
// verification and release-scripts jobs read it there), while every script the
// CD Release job runs — release-tags, first-publish, publish — found the env
// empty and threw. Three throws, one missing line, and no release could run at
// all.
//
// Duplicating the list into cd.yml would recreate the drift its own comment
// warns about ("a package ends up published but never verified — or verified
// but never published"), in the silent direction: a package added to one file
// and not the other is simply absent from that half of the pipeline, and
// nothing goes red. So cd.yml READS the list out of ci.yml at run time — the
// same call `matches-ci-filter` makes in the origin host, and for the same
// reason: a second copy rots the first time the first one moves.
//
// Extraction is textual on purpose. The block's shape (`PUBLISH_DIRS: >-`
// followed by indented `packages/...` lines) is asserted by the selftest, and
// a parse that finds nothing THROWS — the failure mode this replaces was three
// steps discovering emptiness one at a time.

import { appendFileSync, readFileSync } from "node:fs";

export function extractPublishDirs(workflowText) {
  const match = workflowText.match(/^\s*PUBLISH_DIRS: >-\n((?:\s+packages\/\S+\n)+)/m);
  if (!match) {
    throw new Error(
      "ci.yml no longer declares the PUBLISH_DIRS block this script reads — " +
        "move the list (or point cd.yml at its new home) rather than releasing nothing.",
    );
  }
  return match[1].split("\n").map((line) => line.trim()).filter(Boolean);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const dirs = extractPublishDirs(readFileSync(".github/workflows/ci.yml", "utf8"));
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is unset — run this inside a workflow step");
  appendFileSync(process.env.GITHUB_ENV, `PUBLISH_DIRS=${dirs.join(" ")}\n`);
  console.log(`PUBLISH_DIRS: ${dirs.length} package dirs, read from ci.yml`);
}
