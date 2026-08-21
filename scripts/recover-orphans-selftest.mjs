#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves scripts/recover-orphans.mjs deletes ONLY what is safe to delete.
 *
 * This is the one script in the release job that destroys something. Deleting an
 * orphaned tag is safe precisely because the version it names is not on the
 * registry — nothing can depend on it, `npm i pkg@that-version` was already an
 * error, and the release re-cuts it minutes later. Every one of those clauses is
 * about the package being an ORPHAN. Applied to any other package the same
 * deletion is destructive:
 *
 *   - a HEALTHY package's newest tag is the published version's tag, and
 *     deleting it makes semantic-release re-cut a version npm already has, which
 *     publish.mjs then reports as "skipped" — a release that silently does
 *     nothing, forever.
 *   - a package the registry has never seen is a FIRST PUBLISH, not a fault.
 *     `registryVersions` returns null for it rather than an empty list, and a
 *     caller that conflates the two deletes the tag of a package that is merely
 *     new.
 *
 * None of that is visible in a log — the script would report a successful
 * recovery in every case. So the cases below assert on the `git` calls actually
 * made, with the two "must not touch" ones carrying as much weight as the one
 * that does the work.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECOVER = join(HERE, "recover-orphans.mjs");

/**
 * A `git` that answers tag lookups from the plan and RECORDS every invocation.
 *
 * `push --delete` obeys the plan's `pushFails`, so a case can put the script in
 * front of a repository whose rules forbid deleting a tag — which is a real
 * possibility here and must not read as a successful recovery.
 */
const FAKE_GIT = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GIT_CALLS, args.join(" ") + "\\n");
if (args[0] === "rev-parse" && args[1] === "HEAD") {
  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");
  process.exit(0);
}
if (args[0] === "tag" && args[1] === "--list") {
  const pkg = args[2].replace(/-v\\*$/, "");
  const entry = plan[pkg];
  if (entry && entry.tag) process.stdout.write(entry.tag + "\\n");
  process.exit(0);
}
if (args[0] === "push" && args.includes("--delete")) {
  if (process.env.FAKE_PUSH_FAILS === "1") {
    process.stderr.write("remote: error: refusing to delete a protected tag\\n");
    process.exit(1);
  }
}
if (args[0] === "push" && String(args[2] || "").startsWith("refs/tags/")) {
  if (process.env.FAKE_TAG_PUSH_FAILS === "1") {
    process.stderr.write("remote: error: refusing to create a protected tag\\n");
    process.exit(1);
  }
}
process.exit(0);
`;

/** An `npm view` that answers from the plan; a missing `versions` means "not on the registry". */
const FAKE_NPM = `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "view") {
  const pkg = args[1].replace(/^@selftest\\//, "");
  const entry = plan[pkg];
  if (!entry || !entry.versions) process.exit(1);
  // \`lateVersion\` is npm's read-after-write lag: accepted, not yet served.
  // The first \`lateAfter\` reads answer without it; later reads include it.
  let versions = entry.versions;
  if (entry.lateVersion) {
    const counts = existsSync(process.env.FAKE_NPM_CALLS)
      ? JSON.parse(readFileSync(process.env.FAKE_NPM_CALLS, "utf8"))
      : {};
    counts[pkg] = (counts[pkg] || 0) + 1;
    writeFileSync(process.env.FAKE_NPM_CALLS, JSON.stringify(counts));
    if (counts[pkg] > (entry.lateAfter || 1)) versions = [...versions, entry.lateVersion];
  }
  process.stdout.write(JSON.stringify(versions));
}
process.exit(0);
`;

/** A GitHub Releases API that records what was asked of it. */
function githubStub(hasRelease) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, path: req.url.split("?")[0] });
    if (req.method === "GET" && !hasRelease) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(req.method === "DELETE" ? 204 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 368170853 }));
  });
  return { server, calls };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "recover-orphans-selftest-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  for (const [name, source] of [
    ["git", FAKE_GIT],
    ["npm", FAKE_NPM],
  ]) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  const dirs = packages.map((pkg) => {
    const dir = join(root, pkg);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@selftest/${pkg}`, version: "1.0.0" }));
    return dir;
  });
  return { root, bin, dirs };
}

/** Runs the real scripts/recover-orphans.mjs over a scripted git, npm and API. */
async function recover({ plan, hasRelease = true, pushFails = false, tagPushFails = false, env = {} }) {
  const { root, bin, dirs } = workspace(Object.keys(plan));
  const planFile = join(root, "plan.json");
  const gitCalls = join(root, "git.log");
  const npmCalls = join(root, "npm-calls.json");
  writeFileSync(planFile, JSON.stringify(plan));
  writeFileSync(gitCalls, "");
  writeFileSync(npmCalls, "{}");

  const { server, calls } = githubStub(hasRelease);
  const port = await listen(server);

  // `spawn`, not `spawnSync`: the stub API is served by this process, so a
  // synchronous spawn would block the loop that has to answer the child's fetch.
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [RECOVER], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PUBLISH_DIRS: dirs.join(" "),
        FAKE_PLAN: planFile,
        FAKE_GIT_CALLS: gitCalls,
        FAKE_NPM_CALLS: npmCalls,
        // No waiting unless a case asks for it: the real schedule is minutes
        // long (lib/release-state.mjs), which is right in CI and unrunnable here.
        RELEASE_ABSENCE_RECHECK_MS: "",
        FAKE_PUSH_FAILS: pushFails ? "1" : "0",
        FAKE_TAG_PUSH_FAILS: tagPushFails ? "1" : "0",
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
        GITHUB_REPOSITORY: "12-apps/shared-packages",
        GITHUB_TOKEN: "selftest-token",
        RELEASE_AUTO_RECOVER: "",
        ...env,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
  server.close();

  const git = readFileSync(gitCalls, "utf8").split("\n").filter(Boolean);
  return {
    ...result,
    git,
    api: calls,
    deletedTags: git.filter((call) => call.startsWith("push") && call.includes("--delete")),
    deletedLocal: git.filter((call) => call.startsWith("tag -d")),
    deletedReleases: calls.filter((c) => c.method === "DELETE"),
  };
}

const failures = [];

function check(label, passed, detail) {
  if (passed) {
    console.log(`  ok  ${label}`);
    return;
  }
  failures.push(`${label}\n    ${detail}`);
}

// The incident, as state: tagged 1.22.0, registry stops at 1.21.0.
const ORPHAN = { auth: { tag: "auth-v1.22.0", versions: ["1.20.0", "1.21.0"] } };
const HEALTHY = { auth: { tag: "auth-v1.22.0", versions: ["1.21.0", "1.22.0"] } };
const NEVER_PUBLISHED = { auth: { tag: "auth-v1.0.0" } };

// ── The orphan: delete the tag, the local tag, and the GitHub Release ────────
const orphan = await recover({ plan: ORPHAN });

check(
  "an orphaned tag is deleted on the remote",
  orphan.deletedTags.some((call) => call.includes("auth-v1.22.0")),
  `expected a push --delete of auth-v1.22.0; git saw:\n    ${orphan.git.join("\n    ")}`,
);
check(
  "the LOCAL tag goes too, or semantic-release still sees it in this same checkout",
  orphan.deletedLocal.some((call) => call.includes("auth-v1.22.0")),
  `the release runs later in this very checkout — a tag left locally keeps the\n    package looking released and defeats the recovery. git saw:\n    ${orphan.git.join("\n    ")}`,
);
check(
  "the GitHub Release is deleted as well",
  orphan.deletedReleases.length === 1,
  `a Release left pointing at a deleted tag blocks re-cutting it. API saw:\n    ${orphan.api
    .map((c) => `${c.method} ${c.path}`)
    .join("\n    ")}`,
);
check(
  "the run stays green so the release it is unblocking can proceed",
  orphan.status === 0,
  `expected exit 0 after a successful recovery, got ${orphan.status}`,
);
check(
  "it says the version will be re-cut, not merely that a tag was removed",
  /re-cut/i.test(orphan.output),
  `a reader must know the package is being fixed, not just altered. Output:\n    ${orphan.output}`,
);

// ── A healthy package must not be touched ───────────────────────────────────
const healthy = await recover({ plan: HEALTHY });

check(
  "a package whose newest tag IS on the registry is left alone",
  healthy.deletedTags.length === 0 && healthy.deletedReleases.length === 0,
  `deleting a healthy tag makes semantic-release re-cut a published version,\n    which publish.mjs skips — a release that silently does nothing. git saw:\n    ${healthy.git.join("\n    ")}`,
);
check(
  "and it says so rather than staying silent",
  /no orphaned release tags/i.test(healthy.output),
  `expected the healthy case to report itself. Output:\n    ${healthy.output}`,
);

// ── A package the registry has never seen is a FIRST PUBLISH, not an orphan ──
const fresh = await recover({ plan: NEVER_PUBLISHED });

check(
  "a package not on the registry at all is NOT treated as an orphan",
  fresh.deletedTags.length === 0 && fresh.deletedReleases.length === 0,
  `registryVersions returns null for an unpublished name rather than an empty\n    list; conflating the two deletes the tag of a package that is merely new.\n    git saw:\n    ${fresh.git.join("\n    ")}`,
);

// ── The kill switch ─────────────────────────────────────────────────────────
const disabled = await recover({ plan: ORPHAN, env: { RELEASE_AUTO_RECOVER: "false" } });

check(
  "RELEASE_AUTO_RECOVER=false reports the orphan and deletes nothing",
  disabled.deletedTags.length === 0 &&
    disabled.deletedReleases.length === 0 &&
    /auth-v1\.22\.0/.test(disabled.output),
  `the switch must still SAY what it found. git saw:\n    ${disabled.git.join(
    "\n    ",
  )}\n    output: ${disabled.output}`,
);

// ── A repository that refuses the deletion ──────────────────────────────────
const refused = await recover({ plan: ORPHAN, pushFails: true });

check(
  "a refused tag deletion fails the step instead of reporting a recovery",
  refused.status === 1,
  `expected exit 1 when the remote refuses; got ${refused.status}. A rule that\n    forbids deleting tags must not read as a successful recovery`,
);
check(
  "and it says the package is still stuck",
  /stuck/i.test(refused.output) && /protected tag/i.test(refused.output),
  `the reader needs git's own refusal, not just "could not delete". Output:\n    ${refused.output}`,
);

// ── An orphan with no GitHub Release is an ordinary case, not a failure ──────
const noRelease = await recover({ plan: ORPHAN, hasRelease: false });

check(
  "an orphan whose GitHub Release does not exist still gets its tag deleted",
  noRelease.deletedTags.length === 1 && noRelease.status === 0,
  `the tag and the Release are created separately, so either can exist without\n    the other; a missing Release must not block the deletion that matters.\n    git saw:\n    ${noRelease.git.join("\n    ")}`,
);

// ── The MIRROR of an orphan: published, with no tag ──────────────────────────
//
// Deleting is not the remedy here — nothing is there to delete. The version is
// on the registry and no tag records it, so semantic-release has no floor, will
// re-cut that version, and publish.mjs will report "skipped" while the run goes
// green and the release is swallowed. The repair is to WRITE the tag.
const UNTAGGED = { scope: { versions: ["1.0.0"] } };
const untagged = await recover({ plan: UNTAGGED });

check(
  "a published package with no tag gets the missing tag created",
  untagged.git.some((call) => /^tag scope-v1\.0\.0 /.test(call)),
  `nothing else in the release job writes this tag, so if this does not, the\n    next release re-cuts 1.0.0 and ships nothing. git saw:\n    ${untagged.git.join("\n    ")}`,
);

check(
  "the tag is PUSHED, not just made locally",
  untagged.git.some((call) => call.includes("push origin refs/tags/scope-v1.0.0")),
  `semantic-release reads tags from the checkout, but the NEXT run reads them\n    from the remote — a local-only tag fixes this run and nothing after it.\n    git saw:\n    ${untagged.git.join("\n    ")}`,
);

check(
  "nothing is deleted while repairing it",
  !untagged.git.some((call) => call.includes("--delete")) && untagged.deletedReleases.length === 0,
  `this is the opposite repair to an orphan's. Deleting anything here would be\n    destroying a record rather than restoring one. git saw:\n    ${untagged.git.join("\n    ")}`,
);

check(
  "the run stays green so the release it unblocks can proceed",
  untagged.status === 0,
  `expected exit 0 after a successful repair, got ${untagged.status}. Output:\n    ${untagged.output}`,
);

// ── A refused tag push must not leave the tag behind locally ─────────────────
const tagRefused = await recover({ plan: UNTAGGED, tagPushFails: true });

check(
  "a refused tag push fails the step instead of reporting a repair",
  tagRefused.status !== 0,
  `a green run here would claim the package is fixed when the remote never got\n    the tag. Output:\n    ${tagRefused.output}`,
);

check(
  "and the local tag is removed again, or this run cuts nothing at all",
  tagRefused.git.some((call) => call === "tag -d scope-v1.0.0"),
  `semantic-release runs later in THIS checkout: a tag left locally but absent\n    from the remote makes it see a released version and cut nothing, which is\n    worse than the state being repaired and just as silent. git saw:\n    ${tagRefused.git.join("\n    ")}`,
);

// ── The opt-out covers the new direction too ─────────────────────────────────
const untaggedOff = await recover({ plan: UNTAGGED, env: { RELEASE_AUTO_RECOVER: "false" } });

check(
  "RELEASE_AUTO_RECOVER=false reports the untagged package and writes nothing",
  untaggedOff.status === 0 &&
    !untaggedOff.git.some((call) => /^tag scope-v/.test(call)) &&
    /no scope-v\* tag/.test(untaggedOff.output),
  `the escape hatch must cover both repairs, or turning it off still mutates\n    the repository. Output:\n    ${untaggedOff.output}\n    git saw:\n    ${untaggedOff.git.join("\n    ")}`,
);

// ── The registry's read-after-write lag, against the script that DELETES ────
//
// npm answers `publish` with `ok` before it serves the version, so a read taken
// straight afterwards is honestly, temporarily wrong — @12-apps/feature-flags
// was called stuck twice in one night over versions npm served minutes later.
// Here that answer is not a wrong report but a deletion: the tag of a PUBLISHED
// version goes, semantic-release re-cuts a version npm already has, publish.mjs
// says "skipped", and the package silently stops releasing. It is the HEALTHY
// case above reached through a slow registry, and one read cannot tell them apart.
const propagating = await recover({
  plan: { auth: { tag: "auth-v1.22.0", versions: ["1.21.0"], lateVersion: "1.22.0" } },
  env: { RELEASE_ABSENCE_RECHECK_MS: "1,1,1" },
});

check(
  "a tag whose version arrives on a re-read is left alone",
  propagating.deletedTags.length === 0 && propagating.deletedLocal.length === 0,
  `deleting it re-cuts a PUBLISHED version, npm refuses it, and the package stops shipping while every step reports success. git saw:\n    ${propagating.git.join("\n    ")}`,
);

check(
  "and its GitHub Release survives too",
  propagating.deletedReleases.length === 0,
  `it carries the notes for a version that IS on the registry. API saw:\n    ${JSON.stringify(propagating.api)}`,
);

// Patience must not become blindness: a tag whose version never arrives is the
// orphan this script exists for, and still has to go.
const stillAbsent = await recover({ plan: ORPHAN, env: { RELEASE_ABSENCE_RECHECK_MS: "1,1,1" } });

check(
  "a version that never arrives is still recovered after the re-reads",
  stillAbsent.deletedTags.some((call) => call.includes("auth-v1.22.0")),
  `waiting removes false orphans, not real ones — a real one left in place is\n    ` +
    `the four-day auth-v1.22.0 outage again. git saw:\n    ${stillAbsent.git.join("\n    ")}`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n`);
  for (const failure of failures) console.log(`  FAIL  ${failure}\n`);
  process.exit(1);
}
console.log("\nrecover-orphans.mjs repairs both directions and touches nothing else");
