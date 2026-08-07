import { config as baseConfig } from '@12-apps/eslint-config/base';

/**
 * The step definitions are Playwright test code, so the repo's test-oriented
 * relaxations apply: `expect` outside a `test()` block is normal here (a step
 * IS the assertion), and the files are never bundled into an app.
 */
export default [...baseConfig];
