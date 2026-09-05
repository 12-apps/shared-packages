// Reads the ANDROID export for what must and must not be in it.
//
// `expo export --platform android` runs Metro for a native platform with no
// emulator involved, so it is the cheapest proof that the `react-native` export
// condition resolves where it matters: in the bundle a device would load. The
// assertions are strings the two renderers cannot share — the web build
// imports `@mui/material` and `react-dom`; the native build draws its icons
// from the generated path data and reads `UiThemeContext`.
//
// Usage: node scripts/check-bundle.mjs dist/android
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist/android';

function bundles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return bundles(full);
    return /\.(hbc|js)$/.test(entry) ? [full] : [];
  });
}

const files = bundles(root);
if (files.length === 0) {
  console.error(`check-bundle: no bundle under ${root} — did \`expo export --platform android\` run?`);
  process.exit(1);
}
const source = files.map((file) => readFileSync(file, 'latin1')).join('\n');

// The Close glyph's path, as generated into @12-apps/ui's paths.generated.ts.
const MUST_CONTAIN = [
  ['the generated icon paths (the native Icon)', 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'],
  ['the harness gallery', 'section-button'],
];
const MUST_NOT_CONTAIN = [
  ['MUI', '@mui/material'],
  ['emotion', '@emotion/react'],
  ['react-dom', 'react-dom/client'],
  ['MUI class names', 'MuiButton-root'],
];

let failed = false;
for (const [what, needle] of MUST_CONTAIN) {
  if (!source.includes(needle)) {
    console.error(`check-bundle: MISSING ${what} (${needle.slice(0, 40)}…)`);
    failed = true;
  }
}
for (const [what, needle] of MUST_NOT_CONTAIN) {
  if (source.includes(needle)) {
    console.error(`check-bundle: FOUND ${what} ("${needle}") in the android bundle — the web renderer leaked into Metro`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`check-bundle: ${files.length} bundle file(s) under ${root}; native renderer present, web renderer absent.`);
