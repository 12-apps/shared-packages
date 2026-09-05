// @storybook/test-runner's Jest config, with one addition for a machine that
// has a Chromium but not the exact build Playwright wants to download.
//
// `.cjs` because the package is `"type": "module"` and the runner requires
// this file as CommonJS; its `test-runner-jest*` glob picks up either name.
//
// The runner is jest-playwright, and jest-playwright launches whatever
// playwright-core resolves — a versioned `chromium_headless_shell-NNNN` under
// PLAYWRIGHT_BROWSERS_PATH. A sandbox that pre-installs one Chromium (and blocks
// the download) has the binary and not the version-named directory, so the
// launch dies on `Executable doesn't exist`. `STORYBOOK_CHROMIUM_PATH` points
// the launch at that binary. Unset, nothing changes: CI installs the exact
// build and this file is the default config.
const { getJestConfig } = require('@storybook/test-runner');

const base = getJestConfig();
const executablePath = process.env.STORYBOOK_CHROMIUM_PATH;

module.exports = {
  ...base,
  testEnvironmentOptions: {
    ...base.testEnvironmentOptions,
    'jest-playwright': {
      ...base.testEnvironmentOptions?.['jest-playwright'],
      ...(executablePath
        ? { launchOptions: { ...base.testEnvironmentOptions?.['jest-playwright']?.launchOptions, executablePath } }
        : {}),
    },
  },
};
