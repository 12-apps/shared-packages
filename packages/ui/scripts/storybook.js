import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const pathCache = new Map();
const binCache = new Map();

function binPath(bin) {
  if (!binCache.has(bin)) {
    const binName = process.platform === 'win32' ? `${bin}.cmd` : bin;
    // Try local node_modules first, then workspace root
    const localBin = path.join(process.cwd(), 'node_modules', '.bin', binName);
    const rootBin = path.join(process.cwd(), '..', '..', 'node_modules', '.bin', binName);

    // Check if local exists first, otherwise use root
    try {
      fs.accessSync(localBin, fs.constants.F_OK);
      binCache.set(bin, localBin);
    } catch {
      binCache.set(bin, rootBin);
    }
  }
  return binCache.get(bin);
}

function exists(p) {
  if (!pathCache.has(p)) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      pathCache.set(p, true);
    } catch {
      pathCache.set(p, false);
    }
  }
  return pathCache.get(p);
}

const STORY_FILE = /\.stories\.(tsx|ts|jsx|js)$/;

/**
 * Whether every tag appears in the file's source, in any of the three quote
 * styles it could have been written with. AND logic: one miss disqualifies it.
 *
 * This is a text search rather than a parse, so a tag named in a comment counts
 * — which is why it only ever narrows an already-tag-filtered run.
 */
function hasAllTags(content, tags) {
  return tags.every(
    (tag) =>
      content.includes(`'${tag}'`) || content.includes(`"${tag}"`) || content.includes(`\`${tag}\``),
  );
}

/** Every story file under `dir`, recursively, skipping dotfiles and node_modules. */
function collectStoryFiles(dir, tags, found) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        collectStoryFiles(fullPath, tags, found);
      }
    } else if (STORY_FILE.test(file) && hasAllTags(fs.readFileSync(fullPath, 'utf8'), tags)) {
      found.push(fullPath);
    }
  }
}

// Get stories that match a specific tag by parsing the stories
function getStoriesWithTags(tags) {
  const found = [];

  try {
    collectStoryFiles(path.join(process.cwd(), 'src'), tags, found);
  } catch (e) {
    console.error('Error finding stories:', e);
  }

  return found;
}

export async function pingStorybook(url) {
  if (process.env.SKIP_STORYBOOK_PING === 'true') return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return;
  } catch {
    const curl = exists(binPath('curl')) ? binPath('curl') : 'curl';
    const res = spawnSync(curl, ['-sSfI', url], { stdio: 'ignore' });
    if (res.status !== 0) {
      const v = spawnSync(curl, ['-vL', url], { encoding: 'utf8' });
      if (v.stdout) console.error(v.stdout);
      if (v.stderr) console.error(v.stderr);
      console.error(`Unable to reach Storybook at ${url}`);
      process.exit(1);
    }
  }
}

function run(command, args, env = {}) {
  console.error(`\n> Running: ${[command, ...args].join(' ')}\n`);
  const res = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status ?? 1;
}

/** Runs a command and exits the process with its status if it failed. */
function runOrExit(bin, args, label) {
  const code = run(bin, args);
  if (code !== 0) {
    console.error(`\n❌ ${label} failed. See logs above.`);
    process.exit(code);
  }
}

/**
 * The CI-only flags, which are all read from the environment. Watch mode takes
 * none of them: they are about a single reproducible run.
 */
function ciArgs() {
  const args = ['--ci', '--maxWorkers', process.env.MAX_WORKERS || '4'];

  if (process.env.TEST_TIMEOUT) args.push('--testTimeout', process.env.TEST_TIMEOUT);
  if (process.env.COVERAGE === 'true') args.push('--coverage');
  if (process.env.SHARD) args.push('--shard', process.env.SHARD);

  return args;
}

/**
 * Arguments for @storybook/test-runner.
 *
 * With a tag and no watch, the matching files are passed as positional
 * arguments — test-storybook forwards extra args to Jest, so this narrows the
 * run to those files. The tag filter is still passed, since a matched file can
 * hold untagged stories too.
 */
function testRunnerArgs(url, tag, watchMode) {
  const args = ['--url', url, ...(watchMode ? ['--watch'] : [])];

  if (tag && !watchMode) {
    const taggedStories = getStoriesWithTags(tag);

    if (taggedStories.length === 0) {
      console.error(`No stories found with tags: ${tag.join(', ')}`);
      process.exit(0);
    }

    console.error(`Found ${taggedStories.length} story file(s) with tags: ${tag.join(', ')}`);
    args.push(...taggedStories, '--includeTags', String(tag));
  } else if (tag) {
    args.push('--includeTags', String(tag));
  }

  if (!watchMode) args.push(...ciArgs());

  return args;
}

/** Arguments for the storybook CLI's own `test` command, used as a fallback. */
function storybookCliArgs(url, tag, watchMode) {
  const args = ['test', '--url', url];

  if (!watchMode && process.env.COVERAGE !== 'true') args.push('--coverage=false');
  if (tag && String(tag).trim()) args.push('--includeTags', String(tag));
  if (watchMode) args.push('--watch');

  return args;
}

/** Neither runner is installed — say what is missing and what is there instead. */
function reportNoRunner(testStorybookBin) {
  let bins;
  try {
    bins = fs.readdirSync(path.join(process.cwd(), 'node_modules', '.bin')).sort().join('\n  ');
  } catch {
    bins = '(node_modules/.bin not found — did you run pnpm install?)';
  }

  console.error(
    [
      'No Storybook test runner executable found in node_modules/.bin.',
      '',
      'Try:',
      '  pnpm install',
      '  pnpm add -D @storybook/test-runner @storybook/test',
      '',
      `Then this should exist: ${testStorybookBin}`,
      '',
      'Current node_modules/.bin contents:',
      `  ${bins}`,
    ].join('\n'),
  );
  process.exit(1);
}

export function runStorybookTestsFailFast(url, tag, watchMode = false) {
  const testStorybookBin = binPath('test-storybook');
  const storybookBin = binPath('storybook');

  if (exists(testStorybookBin)) {
    runOrExit(testStorybookBin, testRunnerArgs(url, tag, watchMode), 'test-storybook');
    return;
  }

  if (exists(storybookBin)) {
    runOrExit(storybookBin, storybookCliArgs(url, tag, watchMode), 'storybook test');
    return;
  }

  reportNoRunner(testStorybookBin);
}
