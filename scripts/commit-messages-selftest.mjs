#!/usr/bin/env node
/**
 * Proves the pre-push hook refuses what CI's commitlint refuses, and lets
 * through every push CI never lints, by pushing for real: a throwaway
 * repository, a bare remote, and `core.hooksPath` pointed at this checkout's
 * `.githooks`, so git itself finds the hook and runs it.
 *
 * #606 is why it exists. A merge commit made with `git merge -m`, whose body line
 * ran past 100 characters, reached the remote because nothing on the machine read
 * the rules. CI's `Commit messages` check turned red one push later. The hook
 * (`.githooks/pre-push`) now lints the pushed range with `commitlint.config.mjs`,
 * and the commitlint workflow reads the same file through `config-path`.
 *
 * The first version of the hook refused the release job's own pushes:
 * semantic-release pushes a lightweight tag on the commit `origin/main` already
 * holds, and a `refs/notes/semantic-release-*` commit with no conventional
 * message. Both are here as pushes that must pass, with the others CI never
 * lints, and `prepare` is checked not to turn the hook on under CI.
 *
 * Checked, each against the real files rather than a restatement of them:
 *
 *  - the workflow passes `config-path: commitlint.config.mjs` and leaves
 *    `require-issue-ref` at CI's default, which the hook pins;
 *  - `prepare` points `core.hooksPath` at `.githooks`, except under CI;
 *  - the hook is committed executable, since git skips one that is not;
 *  - the config refuses #606's merge message and accepts a well-formed one;
 *  - a push holding #606's message is refused, and the remote never gets it;
 *  - a push of two new branches, one of them bad, is refused as a whole, in
 *    either order;
 *  - a clean branch, a deletion, a branch with nothing new, a lightweight and an
 *    annotated tag, a notes ref, and a message without an issue reference pushed
 *    from a shell that sets REQUIRE_ISSUE_REF all go through;
 *  - an empty message goes through, as it does in CI, whose range run drops it:
 *    the proof that a branch is linted in that one run, not commit by commit;
 *  - without `origin/main`, a bad commit under a clean tip is still refused, and
 *    with no remote-tracking ref at all only the pushed commit is linted, so
 *    main's own history is never billed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COMMITLINT = join(ROOT, 'node_modules', '.bin', 'commitlint');
const HOOKS = join(ROOT, '.githooks');

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
    env: { ...process.env, REQUIRE_ISSUE_REF: 'false' },
  });
}

/** The environment a developer's push runs in: no CI, no opt-out. */
function pushEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CI;
  delete env.SKIP_PREPUSH;
  return { ...env, ...extra };
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: pushEnv() }).trim();

/** `git push` in `dir`, with its exit code and everything the hook printed. */
function push(dir, args, extraEnv = {}) {
  const run = spawnSync('git', ['push', '--quiet', 'origin', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: pushEnv(extraEnv),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Whether the remote holds `ref`, and at which commit. */
function remoteHas(dir, ref) {
  const run = spawnSync('git', ['ls-remote', '--exit-code', 'origin', ref], { cwd: dir, encoding: 'utf8' });
  return run.status === 0 ? run.stdout.split('\t')[0] : null;
}

/**
 * A throwaway repository wired like a developer's checkout: the hook reached
 * through `core.hooksPath`, the config copied, this checkout's node_modules
 * linked, and `main` already on a bare remote.
 */
function scratchRepo(root) {
  const dir = join(root, 'work');
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'selftest@example.test');
  git(dir, 'config', 'user.name', 'selftest');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  // A global push.negotiate makes a file remote print a spurious warning.
  git(dir, 'config', 'push.negotiate', 'false');
  git(dir, 'config', 'core.hooksPath', HOOKS);
  git(dir, 'remote', 'add', 'origin', remote);
  cpSync(join(ROOT, 'commitlint.config.mjs'), join(dir, 'commitlint.config.mjs'));
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  git(dir, 'add', 'commitlint.config.mjs');
  git(dir, 'commit', '-q', '-m', 'chore: add the commit contract (#1)');
  // A message CI would refuse, already on main: the hook must never bill for it.
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'fixed something on main.');
  // Seeding the remote is not under test.
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dir, env: pushEnv({ SKIP_PREPUSH: '1' }) });
  return dir;
}

console.log('commit-messages selftest');

const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'commitlint.yml'), 'utf8');
check(
  'CI reads commitlint.config.mjs through config-path',
  /config-path:\s*commitlint\.config\.mjs/.test(workflow),
  'the commitlint workflow must pass `config-path: commitlint.config.mjs`, or the hook and CI read different rules',
);
check(
  "CI leaves require-issue-ref at the default the hook pins",
  !/require-issue-ref/.test(workflow),
  'the workflow sets `require-issue-ref`; the hook pins REQUIRE_ISSUE_REF=false and would pass what CI refuses',
);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const prepare = pkg.scripts?.prepare ?? '';
const hooksPathAfterPrepare = (env) => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-messages-prepare-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('sh', ['-c', prepare], { cwd: dir, env });
    // --local: a hooks path set globally is the developer's own, not prepare's.
    const read = spawnSync('git', ['config', '--local', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' });
    return read.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const developerHooks = hooksPathAfterPrepare(pushEnv());
check('prepare points core.hooksPath at .githooks', developerHooks === '.githooks', `it set ${JSON.stringify(developerHooks)}`);
const ciHooks = hooksPathAfterPrepare({ ...pushEnv(), CI: 'true' });
check('prepare leaves core.hooksPath alone under CI', ciHooks === '', `under CI=true it set ${JSON.stringify(ciHooks)}`);

const mode = execFileSync('git', ['ls-files', '--stage', '.githooks/pre-push'], { cwd: ROOT, encoding: 'utf8' });
check('the hook is committed executable', mode.startsWith('100755'), `git ls-files --stage: ${mode.trim() || '(not tracked)'}`);

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

  const root = mkdtempSync(join(tmpdir(), 'commit-messages-selftest-'));
  try {
    const dir = scratchRepo(root);
    const passes = (what, result) => check(what, result.status === 0, `exit ${result.status}: ${result.output}`);

    git(dir, 'switch', '-q', '-c', 'topic');
    git(dir, 'commit', '-q', '--allow-empty', '-m', CLEAN);
    passes('a clean branch goes through, and the bad commit on main is not linted', push(dir, ['topic']));

    git(dir, 'commit', '-q', '--allow-empty', '-m', ESCAPED);
    const bad = git(dir, 'rev-parse', 'HEAD');
    const refused = push(dir, ['topic']);
    check(
      "a push holding #606's merge message is refused",
      refused.status !== 0 && /body-max-line-length/.test(refused.output),
      `exit ${refused.status}: ${refused.output}`,
    );
    check('the remote never gets the refused commit', remoteHas(dir, 'refs/heads/topic') !== bad, 'the remote holds it');

    // Two NEW branches, pushed in both orders: git hands the hook one line per
    // ref, so a hook that stopped after the first would pass whichever came
    // first. (A ref the remote already holds is handed over before new ones.)
    git(dir, 'switch', '-q', '-c', 'clean-too', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'docs(ui): name the second clean branch (#1)');
    for (const order of [
      ['clean-too', 'topic:refs/heads/bad-too'],
      ['topic:refs/heads/bad-too', 'clean-too'],
    ]) {
      const both = push(dir, order);
      check(
        `a push of ${order.join(' and ')} is refused as a whole`,
        both.status !== 0 &&
          /body-max-line-length/.test(both.output) &&
          remoteHas(dir, 'refs/heads/clean-too') === null &&
          remoteHas(dir, 'refs/heads/bad-too') === null,
        `exit ${both.status}: ${both.output}`,
      );
    }
    git(dir, 'switch', '-q', 'topic');

    passes('a branch deletion goes through', push(dir, ['--delete', 'topic']));
    passes('a new branch with nothing main lacks goes through', push(dir, ['main:refs/heads/empty']));

    git(dir, 'tag', 'v1.0.0', 'main');
    passes('a lightweight tag on main goes through, as semantic-release pushes it', push(dir, ['refs/tags/v1.0.0']));
    git(dir, 'tag', '-a', '-m', 'release', 'v1.0.1', 'main');
    passes('an annotated tag goes through', push(dir, ['refs/tags/v1.0.1']));

    git(dir, 'notes', '--ref', 'semantic-release-v1.0.0', 'add', '-m', '{"channels":[null]}', 'main');
    passes(
      "semantic-release's notes ref goes through",
      push(dir, ['refs/notes/semantic-release-v1.0.0']),
    );

    git(dir, 'switch', '-q', '-c', 'no-ref', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix(ui): keep the focus ring visible');
    passes(
      'a message without an issue reference goes through, whatever REQUIRE_ISSUE_REF the shell holds',
      push(dir, ['no-ref'], { REQUIRE_ISSUE_REF: 'true' }),
    );

    git(dir, 'switch', '-q', '-c', 'blank', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '--allow-empty-message', '-m', '');
    passes('an empty message goes through, as CI lets it', push(dir, ['blank']));

    git(dir, 'switch', '-q', '-c', 'buried', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', ESCAPED);
    git(dir, 'commit', '-q', '--allow-empty', '-m', CLEAN);
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    const buried = push(dir, ['buried']);
    check(
      'without origin/main, a bad commit under a clean tip is still refused',
      buried.status !== 0 && /body-max-line-length/.test(buried.output),
      `exit ${buried.status}: ${buried.output}`,
    );

    // A remote added by hand and never fetched: nothing marks where main ends.
    for (const ref of git(dir, 'for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean)) {
      git(dir, 'update-ref', '-d', ref);
    }
    git(dir, 'switch', '-q', '-c', 'unanchored', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', CLEAN);
    passes(
      "with no remote-tracking ref at all, main's own history is not linted",
      push(dir, ['unanchored']),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\nthe hook refuses what CI refuses' : `\n${failures} case(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
