#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { newPackages } from "./lib/new-packages.mjs";
import { declaredDirs } from "./lib/release-state.mjs";
import { MARKER, commentBody, syncComment } from "./trusted-publisher-reminder.mjs";

/**
 * Proves the reminder names exactly the packages a PR ADDS to the published
 * set, and nothing else. A false negative is the stuck release this exists to
 * prevent; a false positive teaches authors to ignore it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "trusted-publisher-reminder.mjs");

const manifests = {
  "packages/old": { name: "@12-apps/old", private: false },
  "packages/fresh": { name: "@12-apps/fresh", private: false },
  "packages/secret": { name: "@12-apps/secret", private: true },
};
const manifestOf = (dir) => manifests[dir] ?? null;
const base = ["packages/old"];
const names = async (input) => (await newPackages({ manifestOf, ...input })).map((p) => p.name);

let ran = 0;
const check = async (label, fn) => {
  await fn();
  ran += 1;
  console.log(`ok - ${label}`);
};

await check("a new publishable package is named", async () => {
  assert.deepEqual(await names({ baseDirs: base, headDirs: [...base, "packages/fresh"] }), ["@12-apps/fresh"]);
});
await check("an existing package is not named", async () => {
  assert.deepEqual(await names({ baseDirs: base, headDirs: base }), []);
});
await check("a private package is never named", async () => {
  assert.deepEqual(await names({ baseDirs: base, headDirs: [...base, "packages/secret"] }), []);
});
await check("a listed directory with no manifest is not named", async () => {
  assert.deepEqual(await names({ baseDirs: base, headDirs: [...base, "packages/ghost"] }), []);
});
await check("a name already on npm is not named", async () => {
  const existsOnRegistry = async () => true;
  assert.deepEqual(await names({ baseDirs: base, headDirs: [...base, "packages/fresh"], existsOnRegistry }), []);
});
await check("an offline registry check degrades to new in this PR", async () => {
  const existsOnRegistry = async () => {
    throw new Error("ENOTFOUND");
  };
  assert.deepEqual(await names({ baseDirs: base, headDirs: [...base, "packages/fresh"], existsOnRegistry }), [
    "@12-apps/fresh",
  ]);
});

// The real script, against the real release-packages.txt: a base missing one
// listed package makes that package "new in this PR".
const scratch = mkdtempSync(join(tmpdir(), "tp-reminder-"));
const head = declaredDirs();
const run = (baseDirs, extra = []) => {
  const file = join(scratch, "base.txt");
  writeFileSync(file, baseDirs.join("\n"));
  const env = { ...process.env, GITHUB_STEP_SUMMARY: "", GITHUB_TOKEN: "", PR_NUMBER: "" };
  return spawnSync("node", [GATE, "--offline", "--base-list", file, ...extra], { encoding: "utf8", env });
};

await check("the script names the added package, with its steps, and exits 0", () => {
  const added = head[head.length - 1];
  const { name } = JSON.parse(readFileSync(join(HERE, "..", added, "package.json"), "utf8"));
  const result = run(head.slice(0, -1));
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`::warning title=Trusted Publisher needed::${name.replace("/", "\\/")} `));
  assert.match(result.stdout, /cd\.yml/);
});
await check("a PR with no new package prints nothing", () => {
  const result = run(head);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});
await check("an unreadable base never fails the PR", () => {
  const result = spawnSync("node", [GATE, "--base-list", join(scratch, "missing.txt")], { encoding: "utf8" });
  assert.equal(result.status, 0);
});

// The sticky comment: ONE comment, edited in place, removed when stale.
const fakeGitHub = (existing) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${new URL(url).pathname}`);
    const ok = { ok: true, status: 200, json: async () => (method === "GET" ? existing : {}) };
    return ok;
  };
  return { calls, fetchImpl };
};
const sync = (existing, body) => {
  const gh = fakeGitHub(existing);
  return syncComment({ body, repo: "o/r", pr: 7, token: "t", fetchImpl: gh.fetchImpl }).then((out) => ({ out, ...gh }));
};
const body = commentBody([{ name: "@12-apps/fresh", dir: "packages/fresh" }]);

await check("the first run creates the comment", async () => {
  const { out, calls } = await sync([], body);
  assert.equal(out, "comment created");
  assert.deepEqual(calls, ["GET /repos/o/r/issues/7/comments", "POST /repos/o/r/issues/7/comments"]);
});
await check("a later run edits it instead of duplicating", async () => {
  const { out, calls } = await sync([{ id: 99, body: `${MARKER} old` }], body);
  assert.equal(out, "comment updated");
  assert.equal(calls[1], "PATCH /repos/o/r/issues/comments/99");
});
await check("a run with nothing new removes a stale comment, and creates none", async () => {
  assert.equal((await sync([{ id: 99, body: MARKER }], null)).out, "stale comment removed");
  const none = await sync([], null);
  assert.equal(none.out, "no comment");
  assert.equal(none.calls.length, 1);
});
await check("a refused or failing API never throws", async () => {
  const refused = await syncComment({
    body,
    repo: "o/r",
    pr: 7,
    token: "t",
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  assert.match(refused, /403/);
  const down = await syncComment({
    body,
    repo: "o/r",
    pr: 7,
    token: "t",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.match(down, /offline/);
});
await check("the comment carries the exact steps", () => {
  assert.match(body, /Settings → Trusted Publisher → GitHub Actions/);
  assert.match(body, /12-apps\/shared-packages/);
  assert.match(body, /\*\*`cd\.yml`\*\*/);
});

console.log(`trusted-publisher-reminder selftest: ${ran} checks passed`);
