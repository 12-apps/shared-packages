/**
 * This repository's commit contract: the rules `12-apps/ci`'s commitlint
 * workflow writes for every consumer (its "Write config" step, identical at
 * `@v1` and `@v2`), kept here verbatim below this header.
 *
 * It lives in the repository so that two things read ONE file:
 *
 * - CI, through `config-path` in `.github/workflows/commitlint.yml`.
 * - The pre-push hook, `.githooks/pre-push`, which lints the commits being
 *   pushed before they leave the machine.
 *
 * Before, nothing ran these rules until CI. #606 pushed a merge commit whose
 * body line ran past 100 characters, made with a plain `git merge -m` that no
 * commit tool wrapped, and CI turned red on it after the push. A hook reading
 * its own copy of the rules could drift from CI in either direction. One file
 * cannot.
 *
 * `REQUIRE_ISSUE_REF` is still read from the environment, as the shared
 * workflow reads it. This repository leaves it off, and the hook and
 * `pnpm lint:commits` pin it to that `false`, so a value left in a shell cannot
 * refuse a message CI passes.
 *
 * The cost of one file in the repository: a pull request that edits it is
 * judged by its own edited rules, so a change here is a change to the gate and
 * is reviewed as one. It also stops following `12-apps/ci`. A rule changed
 * there reaches this repository only when it is copied here.
 */
/**
 * The 12-apps commit contract. Mirrors the rules the internal commit
 * guard enforces, so a message that passes locally passes here.
 *
 * Four of the nine rules have no equivalent in config-conventional
 * and are implemented inline below rather than pulled from a plugin
 * package: keeping them here means the gate has exactly two
 * dependencies and no supply chain of its own.
 */
const TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'test', 'chore', 'perf', 'ci', 'build',
];

/**
 * Imperative mood, conservatively. Only an unambiguous past tense or
 * third person is rejected — a leading verb ending in "ed" or a single
 * "s" — and base verbs that merely share those endings are exempt, so
 * "process", "address", "embed" and "focus" are never flagged.
 */
const IMPERATIVE_EXCEPTIONS = new Set([
  'process', 'address', 'compress', 'express', 'focus', 'pass',
  'bypass', 'dismiss', 'discuss', 'guess', 'press', 'access',
  'cross', 'toss', 'miss', 'embed', 'feed', 'seed', 'speed',
  'need', 'proceed', 'exceed', 'succeed', 'breed', 'bleed',
  'shed', 'wed', 'spread', 'thread',
]);

/**
 * AI attribution, assembled from fragments so this file carries no
 * contiguous tool-name literal to trip its own rule. Blocks the
 * ATTRIBUTION, not the mention: "feat: add openai adapter" is fine,
 * "Generated with <tool>" and a co-author trailer are not.
 */
const AI = ['cl' + 'aude', 'chat' + 'gpt', 'cop' + 'ilot', 'co' + 'dex',
            'gem' + 'ini', 'anthro' + 'pic', 'ope' + 'nai', 'gp' + 't'].join('|');
const AI_ATTRIBUTION = new RegExp(
  '(?:co-?authored-?by:[^\\n]*\\b(?:' + AI + ')\\b)' +
  '|(?:\\b(?:generated|written|created|authored|produced)\\b[^\\n]*\\b(?:with|by)\\b[^\\n]*\\b(?:' + AI + ')\\b)',
  'i',
);

const EMOJI = /\p{Extended_Pictographic}/u;
const requireIssueRef = process.env.REQUIRE_ISSUE_REF === 'true';

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-imperative': ({ subject }) => {
          const first = (String(subject || '').match(/[a-zA-Z]+/) || [''])[0].toLowerCase();
          if (!first || IMPERATIVE_EXCEPTIONS.has(first)) return [true];
          if (/(ss|us)$/.test(first)) return [true];
          if (!/(ed|s)$/.test(first)) return [true];
          return [false, `subject "${first}" must be imperative — "add", not "added"/"adds"`];
        },
        'header-no-emoji': ({ header }) => [
          !EMOJI.test(String(header || '')),
          'header must not contain emoji',
        ],
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(String(raw || '')),
          'remove AI attribution (co-author trailer or "Generated with ...")',
        ],
        'issue-ref-present': ({ raw }) => [
          !requireIssueRef || /\(#\d+\)|\b[A-Z][A-Z0-9]+-\d+\b/.test(String(raw || '')),
          'reference the issue, e.g. "(#123)"',
        ],
      },
    },
  ],
  rules: {
    'type-enum': [2, 'always', TYPES],
    'header-max-length': [2, 'always', 72],
    'subject-full-stop': [2, 'never', '.'],
    'body-max-line-length': [2, 'always', 100],
    'subject-imperative': [2, 'always'],
    'header-no-emoji': [2, 'always'],
    'no-ai-attribution': [2, 'always'],
    'issue-ref-present': [2, 'always'],
    // Off: a scope is useful but not every change has a meaningful one,
    // and an empty-scope failure teaches contributors to invent noise.
    'scope-empty': [0],
  },
};
