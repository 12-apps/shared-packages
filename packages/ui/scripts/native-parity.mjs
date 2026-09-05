// The NATIVE PARITY LEDGER: which subpaths render on React Native, and what
// each still owes. `NATIVE.md`'s table is GENERATED between its markers by this
// script; `--check` fails CI when the table has drifted from the sources it
// summarises — the same discipline as `sync-exports.mjs`, for the same reason:
// a hand-maintained list of "what works natively" is a list somebody forgets.
//
// What it reads, per subpath in `entries.native.json`:
//   - the native entry exists and every `index.native.ts` names a `.native`
//     sibling for each component it exports (a barrel that re-exports the web
//     file would ship MUI to Metro);
//   - which story files the native Storybook will pick up, and how many stories
//     in them are tagged `native-skip` (DOM-only assertions the native
//     test-runner excludes) — so the number of shared tests actually proving
//     parity is printed, not assumed;
//   - the component's `NATIVE-NOTES.md`, if any, for known rendering gaps.
//
// Usage:
//   node scripts/native-parity.mjs           # rewrite the table in NATIVE.md
//   node scripts/native-parity.mjs --check   # fail if it has drifted (CI)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(PACKAGE_ROOT, 'NATIVE.md');
const START = '<!-- native-parity:start -->';
const END = '<!-- native-parity:end -->';

const check = process.argv.includes('--check');
const entries = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'entries.json'), 'utf8'));
const nativeEntries = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'entries.native.json'), 'utf8'));

const problems = [];

/** Story exports in a file, and how many carry the `native-skip` tag. */
function storyCounts(file) {
  const source = readFileSync(file, 'utf8');
  const exported = [...source.matchAll(/^export const (\w+): Story\b/gm)].map((m) => m[1]);
  // A tag list on a story: `tags: [..., 'native-skip', ...]` inside its object.
  // Counted per story by slicing the source between consecutive exports.
  let skipped = 0;
  for (let index = 0; index < exported.length; index += 1) {
    const from = source.indexOf(`export const ${exported[index]}:`);
    const to = index + 1 < exported.length ? source.indexOf(`export const ${exported[index + 1]}:`) : source.length;
    if (/tags:\s*\[[^\]]*'native-skip'/.test(source.slice(from, to))) skipped += 1;
  }
  return { total: exported.length, skipped };
}

const rows = Object.entries(nativeEntries).map(([subpath, source]) => {
  if (!(subpath in entries)) problems.push(`${subpath}: in entries.native.json but not entries.json`);
  const abs = join(PACKAGE_ROOT, source);
  if (!existsSync(abs)) problems.push(`${subpath}: native entry ${source} does not exist`);
  const dir = dirname(abs);

  // A value re-export from a module that HAS a `.native` twin must name the
  // twin: `from './Box'` where `Box.native.tsx` exists is the web component
  // shipped to Metro. Renderer-free modules (metrics, generated paths, the
  // shared resolver) have no twin and pass.
  const barrel = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  for (const m of barrel.matchAll(/^export \{[^}]*\} from '([^']+)';/gm)) {
    const spec = m[1];
    if (/\.native$/.test(spec)) continue;
    const twin = ['.ts', '.tsx'].some((ext) => existsSync(join(dir, `${spec}.native${ext}`)));
    if (twin) problems.push(`${subpath}: ${source} re-exports values from "${spec}" although "${spec}.native" exists — that ships the web renderer to Metro`);
  }

  const stories = readdirSync(dir).filter((f) => /\.stories\.tsx?$/.test(f) && !/\.server\./.test(f));
  const counts = stories.map((f) => storyCounts(join(dir, f))).reduce(
    (acc, c) => ({ total: acc.total + c.total, skipped: acc.skipped + c.skipped }),
    { total: 0, skipped: 0 },
  );
  const notesFile = join(dir, 'NATIVE-NOTES.md');
  const notes = existsSync(notesFile)
    ? readFileSync(notesFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
    : [];

  return {
    subpath,
    stories: counts.total,
    skipped: counts.skipped,
    shared: counts.total - counts.skipped,
    notes,
  };
});

const total = Object.keys(entries).length;
const ported = rows.length;
const header = `Ported: **${ported} of ${total}** public subpaths carry a \`react-native\` condition.\n\n` +
  '| subpath | shared stories run natively | skipped (`native-skip`) | known gaps |\n' +
  '|---|---|---|---|\n';
const body = rows
  .map((r) => `| \`@12-apps/ui/${r.subpath}\` | ${r.shared} | ${r.skipped} | ${r.notes.length ? r.notes.join('; ') : '—'} |`)
  .join('\n');
const table = `${START}\n${header}${body}\n${END}`;

// The declarations Metro's TypeScript reads must not import a web-only package:
// a native consumer has no `@mui/material` to resolve one against. Checked
// whenever the build has run (the lane that lints without building skips it).
const nativeTypes = join(PACKAGE_ROOT, 'dist/types-native');
if (existsSync(nativeTypes)) {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [],
    );
  for (const file of walk(nativeTypes)) {
    const text = readFileSync(file, 'utf8');
    const hit = text.match(/from ['"](@mui\/[^'"]+|@emotion\/[^'"]+|react-dom[^'"]*)['"]/);
    if (hit) problems.push(`${file.slice(PACKAGE_ROOT.length + 1)} imports "${hit[1]}" — a native consumer cannot resolve it`);
  }
}

if (problems.length > 0) {
  console.error('ui native parity: PROBLEMS');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const ledger = readFileSync(LEDGER, 'utf8');
const start = ledger.indexOf(START);
const end = ledger.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`ui native parity: NATIVE.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
const next = ledger.slice(0, start) + table + ledger.slice(end + END.length);

if (check) {
  if (next !== ledger) {
    console.error('ui native parity: DRIFT — NATIVE.md does not match entries.native.json and the stories.\nRun "pnpm native:ledger" and commit the result.');
    process.exit(1);
  }
  console.log(`ui native parity: clean — ${ported}/${total} subpaths, ${rows.reduce((n, r) => n + r.shared, 0)} shared stories run natively.`);
} else {
  writeFileSync(LEDGER, next);
  console.log(`ui native parity: wrote ${ported} rows to NATIVE.md.`);
}
