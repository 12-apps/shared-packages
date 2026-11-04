// Proves the pure parts of test-changed (FUT-4348): argument parsing and the
// nearest-workspace mapping, including nested packages (packages/payments/*).
import {
  groupByWorkspace,
  parseArgs,
  parseWorkspaceGlobs,
  relativeToWorkspace,
  workspaceOf,
} from "./lib/test-changed.mjs";

const LABEL = "[test-changed selftest]";

function assert(condition, message) {
  if (!condition) {
    console.error(`${LABEL} FAILED: ${message}`);
    process.exit(1);
  }
}

const YAML = `packages:
  - "packages/*"
  - "packages/payments/*"

onlyBuiltDependencies:
  - esbuild
`;
const globs = parseWorkspaceGlobs(YAML);
assert(JSON.stringify(globs) === '["packages/*","packages/payments/*"]', `globs parsed wrong: ${globs}`);

const pkgs = new Set([
  "packages/payments",
  "packages/payments/backend",
  "packages/payments/frontend",
  "packages/ui",
  "packages/ui/nested",
]);
const has = (dir) => pkgs.has(dir);

assert(
  workspaceOf("packages/payments/frontend/src/list/choice.ts", globs, has) === "packages/payments/frontend",
  "a nested workspace must win over its parent",
);
assert(workspaceOf("packages/payments/README.md", globs, has) === "packages/payments", "parent workspace file");
assert(workspaceOf("packages/ui/src/a.ts", globs, has) === "packages/ui", "plain workspace file");
assert(
  workspaceOf("packages/ui/nested/x.ts", globs, has) === "packages/ui",
  "a package.json dir that no glob names is not a workspace: the file belongs to the enclosing one",
);
assert(workspaceOf("scripts/foo.mjs", globs, has) === null, "root script is outside");
assert(workspaceOf("package.json", globs, has) === null, "root file is outside");
assert(workspaceOf("packages/orphan/a.ts", globs, has) === null, "a workspace dir without package.json is skipped");

const { byWorkspace, outside } = groupByWorkspace(
  ["packages/ui/b.ts", "packages/ui/a.ts", "packages/ui/a.ts", "README.md", "packages/payments/backend/x.ts"],
  globs,
  has,
);
assert(JSON.stringify([...byWorkspace.keys()]) === '["packages/payments/backend","packages/ui"]', "group keys");
assert(JSON.stringify(byWorkspace.get("packages/ui")) === '["packages/ui/a.ts","packages/ui/b.ts"]', "dedupe and sort");
assert(JSON.stringify(outside) === '["README.md"]', "outside list");
assert(
  JSON.stringify(relativeToWorkspace("packages/ui", ["packages/ui/src/a.ts"])) === '["src/a.ts"]',
  "paths relative to the workspace",
);

assert(parseArgs([]).ok && !parseArgs([]).uncommitted, "no args");
assert(parseArgs(["--uncommitted"]).uncommitted === true, "--uncommitted");
assert(parseArgs(["--help"]).help === true, "--help");
assert(parseArgs(["--all"]).ok === false, "unknown flag rejected");

console.log(
  `${LABEL} ok — nested workspaces map to the nearest owner, outside files are kept apart, bad flags are refused.`,
);
