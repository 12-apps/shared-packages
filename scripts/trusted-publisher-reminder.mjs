// Remind the author of a PR that ADDS a publishable package that npm will need a
// Trusted Publisher for it.
//
// WHY: the new package's first publish goes out on the NPM_TOKEN bootstrap
// (scripts/first-publish.mjs); its next release is refused by OIDC until
// someone registers the Trusted Publisher on npmjs.com (README, "The first
// publish of a new package"). The release run's step summary said so only after
// the merge, and a release got stuck. This says it on the PR.
//
// A REMINDER, NEVER A GATE: it always exits 0, a failed comment included. It
// prints nothing when the PR adds no package. Detection is
// scripts/lib/new-packages.mjs over release-packages.txt, the list the release
// itself reads.
//
// Usage: node scripts/trusted-publisher-reminder.mjs [--base <ref>] [--base-list <file>] [--offline]
//   --base       git ref of the PR's base (default origin/$GITHUB_BASE_REF)
//   --base-list  read the base's package list from a file instead of git
//   --offline    skip the npm registry question (a name already on npm is then reported too)
// In Actions, GITHUB_TOKEN + GITHUB_REPOSITORY + PR_NUMBER enable the sticky comment.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { newPackages, registrationSteps } from "./lib/new-packages.mjs";
import { declaredDirs, parseDirs } from "./lib/release-state.mjs";

/** How the comment recognises itself on the next push. */
export const MARKER = "<!-- trusted-publisher-reminder -->";

const REGISTRY = "https://registry.npmjs.org";

/** True only when the registry answers 200 for the name; anything else (404, offline, timeout) is "not known". */
export async function onRegistry(name, fetchImpl = fetch) {
  const response = await fetchImpl(`${REGISTRY}/${name.replaceAll("/", "%2F")}`, {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  });
  return response.status === 200;
}

export function commentBody(packages) {
  return [
    MARKER,
    "### Trusted Publisher needed for a new package",
    "",
    "This PR adds a package to the published set. Its first publish goes out with the `NPM_TOKEN` bootstrap; the release after that is **refused by OIDC** until a Trusted Publisher is registered on npm. This is a reminder, it does not block the PR.",
    "",
    ...packages.flatMap(({ name, dir }) => [`#### \`${name}\` (\`${dir}\`)`, "", registrationSteps(name), ""]),
    'See README, "The first publish of a new package".',
  ].join("\n");
}

/** Create, update or (when `body` is null) delete the one marked comment. Never throws. */
export async function syncComment({ body, repo, pr, token, api = "https://api.github.com", fetchImpl = fetch }) {
  const call = (path, init = {}) =>
    fetchImpl(`${api}/repos/${repo}/issues${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
    });
  try {
    const list = await call(`/${pr}/comments?per_page=100`);
    if (!list.ok) return `could not list comments (${list.status})`;
    const mine = (await list.json()).find((c) => `${c.body ?? ""}`.includes(MARKER));
    if (!mine && body === null) return "no comment";
    if (!mine) {
      const made = await call(`/${pr}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      return made.ok ? "comment created" : `comment refused (${made.status})`;
    }
    if (body === null) {
      const gone = await call(`/comments/${mine.id}`, { method: "DELETE" });
      return gone.ok ? "stale comment removed" : `comment not removed (${gone.status})`;
    }
    const edited = await call(`/comments/${mine.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
    return edited.ok ? "comment updated" : `comment refused (${edited.status})`;
  } catch (error) {
    return `comment skipped (${error.message})`;
  }
}

function baseDirsFrom(argv) {
  const fileAt = argv.indexOf("--base-list");
  if (fileAt >= 0) return parseDirs(readFileSync(argv[fileAt + 1], "utf8"));
  const refAt = argv.indexOf("--base");
  const ref = refAt >= 0 ? argv[refAt + 1] : `origin/${process.env.GITHUB_BASE_REF ?? "main"}`;
  const shown = spawnSync("git", ["show", `${ref}:release-packages.txt`], { encoding: "utf8" });
  // No readable base list: say nothing rather than call every package new.
  return shown.status === 0 ? parseDirs(shown.stdout) : null;
}

async function main(argv) {
  const baseDirs = baseDirsFrom(argv);
  if (baseDirs === null) {
    console.log("::notice::trusted-publisher-reminder: the base's release-packages.txt is unreadable, skipping");
    return;
  }
  const packages = await newPackages({
    baseDirs,
    headDirs: declaredDirs(),
    existsOnRegistry: argv.includes("--offline") ? null : onRegistry,
  });

  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: pr, GITHUB_STEP_SUMMARY: summary } = process.env;
  const canComment = Boolean(token && repo && pr);
  const outcome = canComment
    ? await syncComment({
        body: packages.length > 0 ? commentBody(packages) : null,
        repo,
        pr,
        token,
        api: process.env.GITHUB_API_URL ?? undefined,
      })
    : "";

  if (packages.length === 0) return;
  for (const { name, dir } of packages) {
    console.log(
      `::warning title=Trusted Publisher needed::${name} (${dir}) is new in this PR. Register its Trusted Publisher on npmjs.com after the first publish: GitHub Actions, 12-apps/shared-packages, cd.yml.`,
    );
  }
  if (outcome) console.log(`trusted-publisher-reminder: ${outcome}`);
  if (summary) {
    appendFileSync(
      summary,
      `${commentBody(packages).replace(MARKER, "").trimStart()}\n`,
    );
  }
}

// Never a gate: whatever goes wrong, the PR stays green.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.log(`::notice::trusted-publisher-reminder skipped: ${error.message}`);
  }
}
