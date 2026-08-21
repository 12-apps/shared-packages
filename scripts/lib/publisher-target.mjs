// Where a package's npm Trusted Publisher must point, read from the run itself.
//
// A Trusted Publisher names ONE workflow FILE. npm refuses the OIDC exchange
// when the publishing workflow is not that file, and the refusal is
// indistinguishable from having no publisher at all: both surface as ENEEDAUTH,
// "npm obtained no credential".
//
// This exists because the remedy text in scripts/publish.mjs used to hardcode
// `ci.yml`. #351 moved publishing to cd.yml and every publisher still named
// ci.yml, so eleven packages were refused — and the message printed at that
// moment told the reader to configure the file that had just stopped
// publishing. Advice that is wrong exactly when it is read is worse than none.
//
// GITHUB_WORKFLOW_REF is
// `{owner}/{repo}/.github/workflows/{file}@{ref}`, so the answer is always the
// workflow actually running, and moving the job again cannot make it stale.
export function publisherTarget(env = process.env) {
  const ref = env.GITHUB_WORKFLOW_REF ?? "";
  const path = ref.split("@")[0] ?? "";
  const workflow = path.slice(path.lastIndexOf("/") + 1);
  return {
    repository: env.GITHUB_REPOSITORY || "this repository",
    // Named rather than guessed, but a local run has no ref to read.
    workflow: workflow || "the publishing workflow",
  };
}
