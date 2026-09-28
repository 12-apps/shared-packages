// Proves the viewport-key gate BITES (FUT-2864): a dead `defaultViewport` and
// an unresolved `globals.viewport.value` must both be caught, and neither
// migrated shape nor a legitimate per-file `options` override may false-fire.
import {
  collectLocalOptionKeys,
  findingsFor,
  readPreviewKeys,
  storyFileMatchers,
} from "./viewport-key-gate.mjs";

const LABEL = "[viewport-key selftest]";
const FILE = "packages/ui/src/components/form/Selftest/Selftest.stories.tsx";

const PREVIEW_SAMPLE = `
const preview = {
  parameters: {
    viewport: {
      options: {
        xxs: { name: 'xxs (320)', styles: { width: '320px', height: '568px' } },
        xs: { name: 'xs (400)', styles: { width: '400px', height: '720px' } },
        sm: { name: 'sm (600)', styles: { width: '600px', height: '900px' } },
        md: { name: 'md (900)', styles: { width: '900px', height: '1000px' } },
        lg: { name: 'lg (1200)', styles: { width: '1200px', height: '900px' } },
        xlg: { name: 'xlg (1536)', styles: { width: '1536px', height: '960px' } },
        xxl: { name: 'xxl (2560)', styles: { width: '2560px', height: '1440px' } },
      },
    },
  },
};
export default preview;
`;

function assert(condition, message) {
  if (!condition) {
    console.error(`${LABEL} FAILED: ${message}`);
    process.exit(1);
  }
}

function expectFindings(source, expectedCount, label) {
  const previewKeys = readPreviewKeys(PREVIEW_SAMPLE);
  const findings = findingsFor(FILE, source, previewKeys);
  assert(
    findings.length === expectedCount,
    `${label}: expected ${expectedCount} finding(s), got ${findings.length}: ${JSON.stringify(findings)}`,
  );
  return findings;
}

// 1. readPreviewKeys reads exactly this project's seven breakpoints.
{
  const keys = readPreviewKeys(PREVIEW_SAMPLE);
  const expected = ["xxs", "xs", "sm", "md", "lg", "xlg", "xxl"];
  assert(
    expected.every((k) => keys.has(k)) && keys.size === expected.length,
    `readPreviewKeys: expected exactly ${JSON.stringify(expected)}, got ${JSON.stringify([...keys])}`,
  );
}

// 2. A bare `defaultViewport` is caught, whatever it names — the exact shape
// this gate exists to retire, quoting the FUT-2864 ticket's own example.
{
  const source = `
export const ResponsiveDesign = {
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};
`;
  const [finding] = expectFindings(source, 1, "bare defaultViewport");
  assert(/defaultViewport/.test(finding), `finding should name defaultViewport: ${finding}`);
}

// 3. `defaultViewport` fires even alongside a local `viewports`/`options`
// object — the unmigrated FUT-2778-precedent shape (`viewports` not yet
// renamed, selection not yet moved to `globals`).
{
  const source = `
export const ResponsiveDesign = {
  parameters: {
    viewport: {
      viewports: { mobile: { name: 'Mobile', styles: { width: '375px', height: '667px' } } },
      defaultViewport: 'mobile',
    },
  },
};
`;
  expectFindings(source, 1, "defaultViewport alongside a local viewports map");
}

// 4. `globals.viewport.value` naming a key that is neither one of preview's
// seven NOR a local override is caught — the stock-device typo this ticket
// found 37+28+15+3+1+1 times (mobile1, mobile, responsive, desktop, iphone6,
// ipad), none of which preview.tsx ever defined.
{
  const source = `
export const ResponsiveDesign = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
`;
  const [finding] = expectFindings(source, 1, "globals.value naming an undefined key");
  assert(/mobile1/.test(finding), `finding should name the bad key: ${finding}`);
}

// 5. `globals.viewport.value` naming one of preview.tsx's own seven is clean —
// the migrated, working shape (SettingsLayout.stories.tsx's precedent).
{
  const source = `
export const ResponsiveDesign = {
  globals: { viewport: { value: 'xxs', isRotated: false } },
};
`;
  expectFindings(source, 0, "globals.value naming a preview.tsx key");
}

// 6. A per-file `parameters.viewport.options` override legitimises its own
// keys for `globals.viewport.value` in the SAME FILE — the AppHeader.stories.tsx
// / Form.stories.tsx pattern for a device the project's seven don't stand in for.
{
  const source = `
const meta = {
  parameters: {
    viewport: {
      options: { iphone6: { name: 'iPhone 6', styles: { width: '375px', height: '667px' } } },
    },
  },
};
export const Mobile = {
  globals: { viewport: { value: 'iphone6', isRotated: false } },
};
`;
  expectFindings(source, 0, "globals.value naming a locally-declared option key");
}

// 7. collectLocalOptionKeys reads both the migrated `options` spelling and the
// not-yet-renamed `viewports` spelling, so a file mid-migration is not
// mistakenly flagged as naming an undefined key while it still carries the
// legacy key name (rule 1 above independently flags the unrenamed `viewports`
// itself via its `defaultViewport` sibling, not via this helper).
{
  const withOptions = collectLocalOptionKeys(
    FILE,
    `const meta = { parameters: { viewport: { options: { phone: {} } } } };`,
  );
  assert(withOptions.has("phone"), "collectLocalOptionKeys should read `options` keys");
  const withViewports = collectLocalOptionKeys(
    FILE,
    `const meta = { parameters: { viewport: { viewports: { phone: {} } } } };`,
  );
  assert(withViewports.has("phone"), "collectLocalOptionKeys should also read legacy `viewports` keys");
}

// 8. A clean, fully-migrated file with no viewport override at all reports nothing.
{
  const source = `
export const Default = {
  render: () => null,
};
`;
  expectFindings(source, 0, "a story with no viewport override");
}

// 9. `storyFileMatchers` derives EVERY scan root from `.storybook/main.ts`'s
// own `stories` array — not a hardcoded `packages/ui/src` — so a story added
// under the SECOND root main.ts also loads (`product-research-ui`, FUT-420)
// cannot dodge this gate by living outside a hand-copied path.
{
  const MAIN_SAMPLE = `
const config = {
  stories: [
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../../product-research-ui/src/**/*.stories.@(ts|tsx)',
  ],
};
export default config;
`;
  const matchers = storyFileMatchers(MAIN_SAMPLE);
  assert(matchers.length === 2, `expected 2 story roots, got ${matchers.length}`);
  assert(
    matchers.some((m) => m.root === "packages/ui/src"),
    `expected a packages/ui/src root, got ${JSON.stringify(matchers.map((m) => m.root))}`,
  );
  assert(
    matchers.some((m) => m.root === "packages/product-research-ui/src"),
    `expected a packages/product-research-ui/src root, got ${JSON.stringify(matchers.map((m) => m.root))}`,
  );
  const secondRootFile = "packages/product-research-ui/src/research-screens.stories.tsx";
  assert(
    matchers.some((m) => m.regex.test(secondRootFile)),
    `no matcher matched a real file under the second root: ${secondRootFile}`,
  );
  const outOfScope = "packages/product-research-ui/src/research-screens.test.ts";
  assert(
    !matchers.some((m) => m.regex.test(outOfScope)),
    `a non-.stories file under the second root should not have matched: ${outOfScope}`,
  );
}

console.log(`${LABEL} ok — a dead defaultViewport and an unresolved globals.viewport.value both fire; a ` +
  `migrated selection and a legitimate per-file options override both stay clean.`);
