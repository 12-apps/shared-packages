#!/usr/bin/env node
// Proves the ui-tokens gate BITES (FUT-2585).
//
// "0 new findings" has two causes that look identical from outside: the
// package is clean, or the scanner stopped seeing. So every rule has a
// fixture that breaks it and must be flagged, and one file that does the same
// jobs through the theme and must come back clean — a gate that cries wolf is
// broken in the other direction, and gets exempted wholesale.
//
// The fixtures are inline source handed to the gate's own `scanSource`, under
// a pretend path inside `packages/ui/src/components`, so there is no fixture
// directory for knip, ESLint or tsc to trip over and nothing is written.
import ts from "typescript";

import {
  findingOf,
  parseFinding,
  RULES,
  scanSource,
  scopeFiles,
} from "./ui-tokens-gate.mjs";

const AS = "packages/ui/src/components/form/Selftest/Selftest.tsx";
const AS_METRICS = "packages/ui/src/components/form/Selftest/Selftest.metrics.ts";

const VIOLATIONS = {
  "raw-color": [
    `const a = { color: '#fff' };`,
    `const b = { boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.2)' };`,
    `const c = { backgroundColor: 'white' };`,
    "const d = (theme) => ({ background: `${theme.palette.primary.main}0A` });",
  ],
  "palette-ramp": [
    `const a = (theme) => theme.palette.grey[300];`,
    `const b = (theme) => theme.palette.common.black;`,
    `const c = <Box sx={{ bgcolor: 'grey.100', color: 'common.white' }} />;`,
    `const d = (theme) => theme.palette['grey'][100];`,
  ],
  "raw-font-size": [
    `const a = { fontSize: '0.875rem' };`,
    `const b = <Box sx={{ fontSize: 13 }} />;`,
    `const c = { font: '500 13px Roboto' };`,
    `const d = <Box sx={{ fontSize: { xs: '14px', md: 16 } }} />;`,
  ],
  "raw-length": [
    `const a = { padding: '6px 12px' };`,
    `const e = { borderRadius: '1px' };`,
    "const f = (n) => ({ rootMargin: `${n}px` });",
    `const g = (n) => ({ width: n + 'px' });`,
    `const h = { margin: '10pt' };`,
    `const i = { outlineOffset: '1px' };`,
    `const b = { boxShadow: '0 1px 3px transparent' };`,
    "const c = (n) => ({ width: `${n}px` });",
    `const d = { '@media (max-width: 360px)': { display: 'none' } };`,
  ],
  "raw-number-length": [
    `const A = styled('div')({ gap: 8, padding: 12 });`,
    `const b = <Box sx={{ width: 40, top: 4 }} />;`,
    `const c = <div style={{ marginRight: 8 }} />;`,
    `const METRICS = { rowHeight: 36, panelWidth: 340 };`,
    `const d = <Box sx={{ minWidth: { md: 168 }, width: [40, 60] }} />;`,
    `const e = <Box sx={{ borderTopLeftRadius: 8 }} />;`,
    `const f = { paddingInlineStart: 12, insetInlineStart: 4 };`,
    `const g = (c) => ({ width: c ? 280 : 'auto', maxWidth: c ? 'none' : 384 });`,
    `const h = (c) => <Box sx={{ left: c ? 4 : '50%' }} />;`,
  ],
  "raw-jsx-size": [
    `const a = <CircularProgress size={20} />;`,
    `const b = <Skeleton height={28} />;`,
    `const c = <svg width="20" height="20" viewBox="0 0 20 20" />;`,
  ],
  "px-helper": [`const a = { fontSize: px(14) };`],
  "layout-constant": [
    `const CELL_SIZE = 40;`,
    `const ROW_HEIGHT = 52 as const;`,
    `function List({ itemHeight = 40 }) { return itemHeight; }`,
  ],
};

/** The same jobs, done through the theme. Must produce NOTHING. */
const CLEAN = `
import { alpha } from '@mui/material/styles';
import { rem, sxRem } from '../../../tokens/relative';
const DEFAULT_PAGE_SIZE = 50;
const VIRTUALIZATION_THRESHOLD = 100;
const a = (theme) => ({ color: theme.palette.primary.contrastText, padding: rem(theme, 12) });
const b = <Box sx={{ p: 2, gap: 1, mt: 0.5, borderRadius: 1, width: 1, height: 0.5, fontSize: sxRem(13) }} />;
const c = (theme) => ({ border: '1px solid transparent', boxShadow: \`0 0 0 \${rem(theme, 1)} \${alpha(theme.palette.primary.main, 0.2)}\` });
const d = (theme) => ({ width: '100%', maxWidth: rem(theme, theme.breakpoints.values.sm), margin: '0 auto' });
const e = <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" /></svg>;
const f = { color: 'inherit', background: 'transparent', lineHeight: 1.5, zIndex: 10, opacity: 0.5 };
const hair = (divider) => <Box sx={{ borderBottom: divider ? 1 : 0 }} />;
const g = { margin: 0, top: 0, flex: 1, borderWidth: 1, border: '1px solid transparent', outline: '1px dashed transparent' };
const i = <Grid size={6}><CircularProgress thickness={4} /><Box width={1} height={0.5} /></Grid>;
const HOVER_OFFSET_MS = 300;
const DEBOUNCE_THRESHOLD = 250;
const rootSx = { p: 2, gap: 1 };
const h = (theme, n) => ({ rootMargin: \`\${remPx(theme, n)}px\`, border: \`\${FIELD_BORDER_WIDTH}px solid transparent\` });
`;

/** A metrics table holds the native renderer's dp — only its colours are in scope. */
const METRICS = `
export const SIZES = { sm: { height: 32, paddingHorizontal: 12, fontSize: 14 } };
export const PADDING = '6px 12px';
export const INK = '#fff';
`;

/**
 * TYPE-AWARE: most sizes reach a style through a NAME — a metrics table, a
 * size map — and a literal-only scan reports those files clean. Built as a
 * real program over two in-memory files so the checker resolves the import.
 */
function typedFindings(files, entry) {
  const host = ts.createCompilerHost({ noEmit: true });
  const read = host.readFile.bind(host);
  host.readFile = (f) => files[f] ?? read(f);
  host.fileExists = (f) => f in files || ts.sys.fileExists(f);
  host.directoryExists = (d) => Object.keys(files).some((f) => f.startsWith(`${d}/`)) || ts.sys.directoryExists(d);
  const getSf = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang) => (f in files ? ts.createSourceFile(f, files[f], lang, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : getSf(f, lang));
  const program = ts.createProgram([entry], { jsx: ts.JsxEmit.ReactJSX, noEmit: true, types: [], strict: true }, host);
  return scanSource(entry, files[entry], program.getTypeChecker(), program.getSourceFile(entry)).map((f) => f.rule);
}
const TYPED = {
  "/v/Sel.metrics.ts": [
    "export const SIZES = { sm: { height: 32, font: 14 } } as const; export const MAX_W: number = 400;",
    "export const BORDERS = { rest: 1, focused: 2 } as const; export const FIELD_BORDER_WIDTH = 1;",
  ].join("\n"),
  "/v/Sel.tsx": [
    "import { SIZES, MAX_W, BORDERS, FIELD_BORDER_WIDTH } from './Sel.metrics';",
    "declare const rem: (t: unknown, n: number) => string; declare const theme: unknown;",
    "const a = { height: SIZES.sm.height, maxWidth: MAX_W };",
    "const b = { fontSize: SIZES.sm.font };",
    "const c = { height: rem(theme, SIZES.sm.height) };",
    // Traced to the vocabulary: clean.
    "declare const remPx: (t: unknown, n: number) => number; declare const i: number;",
    "const pitch = remPx(theme, 52); const geometry = { row: remPx(theme, 40) };",
    "const d = { height: pitch, top: i * pitch, width: Math.max(pitch, geometry.row), minHeight: -pitch };",
    "const e = { rootMargin: `${pitch}px`, border: `${FIELD_BORDER_WIDTH}px solid`, borderWidth: FIELD_BORDER_WIDTH };",
    "const rowHeight = remPx(theme, 52); const g = { rowHeight }; const g2 = { height: g.rowHeight, minHeight: Math.max(pitch, 0) };",
    "declare const c: boolean; const g3 = { top: c ? pitch : 0, width: c ? pitch : 'auto', rootMargin: `${c ? pitch : 0}px` };",
    // Raw riding along: flagged.
    "const f = { height: remPx(theme, 52) + 40, borderWidth: BORDERS.focused };",
    // Untyped: cannot be proven relative, so it is reported.
    "declare const untyped: any; const h = { width: untyped };",
  ].join("\n"),
};

const failures = [];
const rulesOf = (path, src) => scanSource(path, src).map((f) => f.rule);

const cases = RULES.flatMap((rule) => (VIOLATIONS[rule] ?? []).map((src) => ({ rule, src })));
for (const { rule, src } of cases) {
  if (!rulesOf(AS, src).includes(rule)) failures.push(`${rule} did NOT fire on: ${src}`);
}
for (const rule of RULES.filter((r) => !(r in VIOLATIONS))) failures.push(`${rule} has no violating fixture`);

const typed = typedFindings(TYPED, "/v/Sel.tsx");
if (typed.filter((r) => r === "raw-number-length").length !== 5) {
  failures.push(`type-aware: expected 5 raw-number-length (height and maxWidth through a name, remPx()+40, a typed 2px border, an untyped width), got ${JSON.stringify(typed)}`);
}
if (typed.some((r) => r === "raw-length")) failures.push(`type-aware: a px glued onto a remPx-traced value was flagged: ${JSON.stringify(typed)}`);
if (typed.filter((r) => r === "raw-font-size").length !== 1) failures.push(`type-aware: expected 1 raw-font-size (fontSize through a name), got ${JSON.stringify(typed)}`);

const cleanHits = scanSource(AS, CLEAN);
if (cleanHits.length > 0) {
  failures.push(`clean fixture flagged ${cleanHits.length}:\n${cleanHits.map((h) => `      ${h.rule} line ${h.line}: ${h.snippet}`).join("\n")}`);
}

const metricsRules = rulesOf(AS_METRICS, METRICS);
if (!metricsRules.includes("raw-color")) failures.push("metrics: a colour in a *.metrics.ts file was not flagged");
if (metricsRules.some((r) => r !== "raw-color")) failures.push(`metrics: lengths were flagged in a *.metrics.ts file (${metricsRules.join(", ")})`);

// The scope is the part a moved folder would silently break.
const scope = scopeFiles();
const mustScan = "packages/ui/src/components/form/Button/Button.styles.ts";
if (!scope.includes(mustScan)) failures.push(`scope lost ${mustScan} — the gate is looking somewhere else`);
if (scope.length < 200) failures.push(`scope holds only ${scope.length} files — expected the whole component tree`);
for (const f of scope) {
  if (/(\.stories\.|\.test\.|__tests__|\.native\.)/.test(f)) failures.push(`scope includes a non-shipped file: ${f}`);
}

const round = parseFinding(findingOf("a/b.ts — raw-color", 3));
if (!round || round.key !== "a/b.ts — raw-color" || round.count !== 3) failures.push("findingOf/parseFinding do not round-trip");

if (failures.length > 0) {
  console.error(`[ui-tokens selftest] ${failures.length} failure(s):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[ui-tokens selftest] ok — ${RULES.length} rules each fire on their fixtures, the clean file stays clean, ${scope.length} files in scope.`);
