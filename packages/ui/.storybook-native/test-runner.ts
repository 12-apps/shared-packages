import type { TestRunnerConfig } from '@storybook/test-runner';

/**
 * A story tagged `native-skip` asserts something only a DOM can answer — the
 * rendered tag behind `as="p"`, a real `<button disabled>`, a heap budget. It
 * still runs in the web Storybook; here it is excluded, and
 * `scripts/native-parity.mjs` counts it in the ledger so the number of shared
 * tests actually proving parity is printed rather than assumed.
 */
const config: TestRunnerConfig = {
  tags: { exclude: ['native-skip'] },
};

export default config;
