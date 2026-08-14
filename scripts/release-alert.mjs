// Tell a human when the release pipeline is not delivering, and stop telling
// them when it is.
//
// WHY this exists. Every guard in this job reports into the run's own log and
// summary, which is exactly where nobody looks: a release runs on push to main,
// long after the author has moved on, and a red Release job is one line in a
// list of green ones. `auth-v1.22.0` was reported by nothing for four days, and
// then only because a consumer in another repository could not resolve an
// import. Five red runs went past in between.
//
// A GitHub issue is the alert channel this repo already has, needs no secret,
// and — unlike a notification — persists until the thing is actually fixed. One
// issue is REUSED rather than one per run: a stuck package that stays stuck for
// a week should be one conversation with a growing history, not seven issues
// nobody closes. The body is rewritten on each run so the top of the thread is
// always the current state, and the issue CLOSES ITSELF once every package's
// newest tag is on the registry, so an open issue always means a live problem.
//
// RELEASE_ALERT_WEBHOOK is optional and additive: set it to a Slack (or any
// JSON) webhook URL to get the same headline pushed somewhere people read
// during the day. Unset, this is a no-op and the issue is the whole alert.
import { releaseState, handedOver, publishDirs } from "./lib/release-state.mjs";

const REPO = process.env.GITHUB_REPOSITORY ?? "";
const TOKEN = process.env.GITHUB_TOKEN ?? "";
const WEBHOOK = process.env.RELEASE_ALERT_WEBHOOK ?? "";
const SERVER = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const RUN_ID = process.env.GITHUB_RUN_ID ?? "";
const JOB_STATUS = process.env.RELEASE_JOB_STATUS ?? "";

const RUN_URL = RUN_ID ? `${SERVER}/${REPO}/actions/runs/${RUN_ID}` : "";

// GitHub Actions sets GITHUB_API_URL on every runner (it differs on Enterprise
// Server), so honouring it is both more correct than hard-coding the host and
// what lets scripts/release-alert-selftest.mjs point this at a local server —
// the only way to assert that a second failing run EDITS the open issue rather
// than filing another one.
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

// How the issue recognises itself on the next run. In the body rather than the
// title so the title stays free to say what is currently wrong.
const MARKER = "<!-- release-alert:shared-packages -->";
const TITLE = "Release pipeline is not delivering to npm";

async function api(path, init = {}) {
  return fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
}

/** The open alert issue, or null. Pull requests are issues to this API — skip them. */
async function findAlertIssue() {
  const response = await api("/issues?state=open&per_page=100");
  if (!response.ok) return null;
  const issues = await response.json();
  return issues.find((issue) => !issue.pull_request && `${issue.body ?? ""}`.includes(MARKER)) ?? null;
}

function bullet(items, describe) {
  return items.map((item) => `- ${describe(item)}`).join("\n");
}

/**
 * What is wrong, in the order a reader needs it: the packages that are STUCK
 * first, because a stuck package is the only failure here that outlives the run.
 */
function buildBody(problems) {
  const { orphans, tagFailed, wedged, incomplete } = problems;
  return [
    MARKER,
    "",
    "The `Release` job on `main` did not get every package to the registry.",
    RUN_URL ? `\nMost recent run: ${RUN_URL}` : "",
    orphans.length > 0
      ? [
          "",
          "### Stuck packages",
          "",
          "These are tagged for a version npm does not have. This state is",
          "self-perpetuating: `semantic-release` reads the tag, concludes there is",
          "nothing new, and the package never releases again — while every run",
          "reports success.",
          "",
          bullet(orphans, (o) => `\`${o.name}\` is tagged \`${o.tag}\` but ${o.version} is not on the registry`),
          "",
          "`scripts/recover-orphans.mjs` deletes an orphaned tag at the start of the",
          "next release so the version re-cuts. If one is still listed here, that",
          "recovery could not run or could not finish — see the run above.",
        ].join("\n")
      : "",
    wedged.size > 0
      ? [
          "",
          "### npm could not authenticate",
          "",
          `${[...wedged].map((n) => `\`${n}\``).join(", ")} — a plain re-run will not fix this.`,
          "The usual cause is a package whose first publish was made with a token, which",
          "creates the NAME but not the Trusted Publisher. Configure one: npmjs.com →",
          "package → Settings → Trusted Publisher → GitHub Actions, `12-apps/shared-packages`,",
          "workflow `ci.yml`.",
        ].join("\n")
      : "",
    tagFailed.size > 0
      ? `\n### Could not be tagged\n\n${[...tagFailed].map((n) => `\`${n}\``).join(", ")}`
      : "",
    incomplete.size > 0
      ? `\n### Did not reach the registry this run\n\n${[...incomplete].map((n) => `\`${n}\``).join(", ")}`
      : "",
    "",
    "---",
    "This issue is maintained by `scripts/release-alert.mjs`. It is rewritten on every",
    "release and closes itself once every package's newest tag is on the registry.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function upsertIssue(body, headline) {
  const existing = await findAlertIssue();
  if (existing) {
    await api(`/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ title: TITLE, body }) });
    await api(`/issues/${existing.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `${headline}\n\n${RUN_URL}` }),
    });
    return existing.number;
  }
  const created = await api("/issues", { method: "POST", body: JSON.stringify({ title: TITLE, body }) });
  if (!created.ok) return null;
  return (await created.json()).number;
}

async function resolveIssue() {
  const existing = await findAlertIssue();
  if (!existing) return null;
  await api(`/issues/${existing.number}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: `Every package's newest tag is on the registry again. Closing.\n\n${RUN_URL}`,
    }),
  });
  await api(`/issues/${existing.number}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  return existing.number;
}

/** Optional, and deliberately best-effort: a webhook must never fail a release. */
async function notifyWebhook(text) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.log(`::warning::release alert webhook failed: ${error.message}`);
  }
}

if (!TOKEN || !REPO) {
  console.log("no GITHUB_TOKEN/GITHUB_REPOSITORY — release alerting skipped");
  process.exit(0);
}

const { orphans } = releaseState(publishDirs());
const problems = {
  orphans,
  tagFailed: handedOver("TAG_FAILED"),
  wedged: handedOver("PUBLISH_WEDGED"),
  incomplete: handedOver("PUBLISH_INCOMPLETE"),
};

// A job that FAILED with nothing stuck is still worth an alert — it means this
// run shipped nothing — but it is not the self-perpetuating kind, so the issue
// closes as soon as a later run goes green.
const anyProblem =
  orphans.length > 0 ||
  problems.tagFailed.size > 0 ||
  problems.wedged.size > 0 ||
  problems.incomplete.size > 0 ||
  JOB_STATUS === "failure";

if (!anyProblem) {
  const closed = await resolveIssue();
  console.log(closed ? `release healthy — closed alert issue #${closed}` : "release healthy — no alert open");
} else {
  const stuck = orphans.map((o) => o.name);
  const headline =
    stuck.length > 0
      ? `Release is STUCK for ${stuck.join(", ")} — tagged, but never published to npm.`
      : "The Release job on main did not get every package to the registry.";
  const number = await upsertIssue(buildBody(problems), headline);
  console.log(number ? `::warning::release alert raised on issue #${number}: ${headline}` : `::warning::${headline}`);
  await notifyWebhook(`${headline}\n${RUN_URL}`);
}
