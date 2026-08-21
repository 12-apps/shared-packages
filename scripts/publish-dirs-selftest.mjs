// Pins for publish-dirs.mjs — the seam between ci.yml's one PUBLISH_DIRS list
// and the CD Release job that reads it.
//
// Two directions matter. The extraction must return the REAL list from the
// committed ci.yml (run against the actual file, so a reshape of the block
// fails here at PR time rather than as a CD run that releases nothing), and it
// must THROW on a workflow with no such block — silence there would be the
// original failure with better manners.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { extractPublishDirs } from "./publish-dirs.mjs";

const real = extractPublishDirs(readFileSync(".github/workflows/ci.yml", "utf8"));
assert.ok(real.length >= 30, `expected the full package list, got ${real.length} entries`);
assert.ok(real.includes("packages/wiring"), "packages/wiring missing from the extracted list");
assert.ok(
  real.includes("packages/payments/backend"),
  "the nested payments workspace missing — the regex must take full paths",
);
assert.ok(
  real.every((dir) => /^packages\/[\w/-]+$/.test(dir)),
  `extraction leaked something that is not a package dir: ${real.join(", ")}`,
);

assert.throws(
  () => extractPublishDirs("env:\n  OTHER: value\n"),
  /no longer declares/,
  "a workflow without the block must throw, not answer an empty list",
);

console.log(`publish-dirs selftest ok — ${real.length} dirs extracted from ci.yml`);
