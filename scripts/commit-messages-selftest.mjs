#!/usr/bin/env node
/**
 * Proves the pre-push hook refuses what CI's commitlint refuses, by pushing
 * nothing: it runs the real hook against a throwaway repository.
 *
 * #606 is why it exists. A merge commit made with `git merge -m`, whose body line
 * ran past 100 characters, reached the remote because nothing on the machine read
 * the rules. CI's `Commit messages` check turned red one push later. The hook
 * (`.githooks/pre-push`) now lints the pushed range with `commitlint.config.mjs`,
 * and the commitlint workflow reads the same file through `config-path`.
 *
 * Checked here, each against the real files rather than a restatement of them:
 *
 *  - the workflow passes `config-path: commitlint.config.mjs`, so the hook and CI
 *    read one file, and `prepare` points `core.hooksPath` at `.githooks`;
 *  - the config refuses #606's own merge message and accepts a well-formed one;
 *  - the hook, fed a push the way git feeds it, refuses a range holding that
 *    message, passes a clean range, never lints what is already on `origin/main`,
 *    and lets a branch deletion through.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMMITLINT = join(ROOT, 'node_modules', '.bin', 'commitlint');
const HOOK = join(ROOT, '.githooks', 'pre-push');
const ZERO = '0'.repeat(40);

/** #606's merge commit, verbatim: the message that reached the remote. */
const ESCAPED = [
  'chore: merge the squash-merged FUT-2393 history back in (FUT-2393)',
  '',
  "The branch's earlier commits landed on main as #603 and #605, squashed. Merging them back keeps " +
    'the push a fast-forward. They add no content: the tree after this merge is the tree before it.',
].join('\n');

const CLEAN = 'feat(ui): add an icon-only social button (#1)\n\nA body line well under the limit.';

let failures = 0;
function check(what, ok, detail) {
  if (ok) {
    console.log(`  ok  ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}\n    ${detail}`);
}

/** Lint one message with the repository's config, the way CI's title step does. */
function lint(message) {
  return spawnSync(COMMITLINT, ['--config', join(ROOT, 'commitlint.config.mjs')], {
    cwd: ROOT,
    input: message,
    encoding: 'utf8',
  });
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A throwaway repository with the hook, the config and this checkout's commitlint. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'commit-messages-selftest-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'selftest@example.test');
  git(dir, 'config', 'user.name', 'selftest');
  git(dir, 'config', 'commit.gpgsign', 'false');
  cpSync(join(ROOT, 'commitlint.config.mjs'), join(dir, 'commitlint.config.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  git(dir, 'add', 'commitlint.config.mjs');
  git(dir, 'commit', '-q', '-m', 'chore: add the commit contract (#1)');
  // A message CI would refuse, already on main and not the root commit (a range
  // never includes its own start): the hook must never bill for it.
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'fixed something on main.');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}

/** Run the hook as git runs it: one "<local ref> <sha> <remote ref> <sha>" line on stdin. */
function push(dir, localSha, remoteSha = ZERO) {
  return spawnSync('sh', [HOOK], {
    cwd: dir,
    input: `refs/heads/topic ${localSha} refs/heads/topic ${remoteSha}\n`,
    encoding: 'utf8',
    env: { ...process.env, SKIP_PREPUSH: '' },
  });
}

console.log('commit-messages selftest');

const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'commitlint.yml'), 'utf8');
check(
  'CI reads commitlint.config.mjs through config-path',
  /config-path:\s*commitlint\.config\.mjs/.test(workflow),
  'the commitlint workflow must pass `config-path: commitlint.config.mjs`, or the hook and CI read different rules',
);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
check(
  'prepare points core.hooksPath at .githooks',
  /git config core\.hooksPath \.githooks/.test(pkg.scripts?.prepare ?? ''),
  `package.json "prepare" is ${JSON.stringify(pkg.scripts?.prepare)}`,
);
check('commitlint is installed', existsSync(COMMITLINT), `${COMMITLINT} is missing; run pnpm install`);

if (existsSync(COMMITLINT)) {
  const escaped = lint(ESCAPED);
  check(
    "the config refuses #606's merge message",
    escaped.status !== 0 && /body-max-line-length/.test(escaped.stdout + escaped.stderr),
    `exit ${escaped.status}: ${escaped.stdout}${escaped.stderr}`,
  );
  const clean = lint(CLEAN);
  check('the config accepts a well-formed message', clean.status === 0, `exit ${clean.status}: ${clean.stdout}`);

  chmodSync(HOOK, 0o755);
  const dir = scratchRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'topic');
    git(dir, 'commit', '-q', '--allow-empty', '-m', CLEAN);
    const good = git(dir, 'rev-parse', 'HEAD');
    const passed = push(dir, good);
    check(
      'the hook passes a clean range and ignores what is already on origin/main',
      passed.status === 0,
      `exit ${passed.status}: ${passed.stdout}${passed.stderr}`,
    );

    git(dir, 'commit', '-q', '--allow-empty', '-m', ESCAPED);
    const bad = git(dir, 'rev-parse', 'HEAD');
    const refused = push(dir, bad, good);
    check(
      "the hook refuses a push holding #606's merge message",
      refused.status === 1 && /body-max-line-length/.test(refused.stdout + refused.stderr),
      `exit ${refused.status}: ${refused.stdout}${refused.stderr}`,
    );

    const deletion = push(dir, ZERO, bad);
    check('the hook lets a branch deletion through', deletion.status === 0, `exit ${deletion.status}: ${deletion.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\nthe hook refuses what CI refuses' : `\n${failures} case(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
