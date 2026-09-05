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

// Metro strips import specifiers from a production bundle (they become
// `_dependencyMap` indices), and MUI builds its class names at runtime, so a
// package name or a class name proves nothing. These are RUNTIME LITERALS that
// exactly one renderer carries, checked against real exports of this harness:
// the native react-native-svg elements register `RNSVGSvgView`/`RNSVGPath`
// (absent from the web export, which draws through react-native-svg's DOM
// shapes); react-dom keys its container fibers `__reactContainer$`; emotion
// tags every style element `data-emotion`; MUI's Button asks the theme for
// overrides by the name `MuiButton`.
const MUST_CONTAIN = [
  ['the native react-native-svg elements (the native Icon)', 'RNSVGSvgView'],
  ['the harness gallery', 'section-button'],
];
const MUST_NOT_CONTAIN = [
  ['react-dom', '__reactContainer$'],
  ['emotion', 'data-emotion'],
  ['MUI', 'MuiButton'],
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
