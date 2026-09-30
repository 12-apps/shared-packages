# Screen test status

## Passed locally

- Package build: all 147 web exports and 28 native exports, declarations and export checks (35.4 s)
- Package check-types: web, native source and native test programs
- Package lint: zero lint errors; existing ESLintEnvWarning notices in Dialog/Toast stories
- Native parity and icon generation: 28/147 subpaths, 625 shared stories, 46 glyphs
- Web unit suite: 188 files, 2,388 tests, zero skipped (121.3 s)
- Native unit suite: 29 files, 369 tests, zero skipped (16.3 s)
- Focused Screen/icon tests: 12 web and 15 native cases
- Full-source consumer candidate: 84 cases across 10 native suites, zero skipped,
  including theme propagation under Android and iOS configurations; typecheck passed

## Coverage

Shared stories: Default, LongContent, TabBarOwnsBottom, ChildOwnsScroll, Empty,
KeyboardForm. Shared play tests: BoundedOverflow, InputRemainsInteractive,
EmptyScreen, ChildViewportStaysBounded.

Positive: theme spacing/color, root accessibility/ref, selected safe-area edges,
keyboard offsets, native scroll callbacks, existing-provider reuse and unseeded
provider fallback. Negative/repeated: disable scrolling/keyboard lift, zero
edges, repeated policy changes, avoid duplicate automatic insets, and prevent
native props leaking to the DOM. Browser geometry, final hosted CI are tracked on PR #736. Final-source unit/type checks and
`pnpm quality` passed at 0fee5e6; the keyboard-disable negative control failed
exactly 2 of 7 tests, and the unchanged positive source passed all 369 native tests.

Device keyboard/rotation/notch QA has not run; no device was available. Neither
react-native-web nor mocked platform tests constitute an observed device keyboard.

## Failures and recovery

- The default package-store path was not writable; explicit workspace paths fixed it
- Temporary storage filled during initial setup. Only task-generated caches were removed
- Two pinned-pnpm dependency resolution/download attempts ended with exit 137.
  The environment's available pnpm 11.19.0 bootstrapped the unchanged frozen
  lockfile in 31.3 s; verification commands use repository-pinned pnpm 10.34.5
- First native focused run used an unsupported Vitest spy helper; using Vitest's
  getter spy fixed both failing platform cases
- Adding Screen required the intentional public-export count assertion to move
  from 146 to 147; the full web suite then passed
- Aggregate complexity flagged the initial render functions; extracting small
  style/keyboard helpers preserves behavior and brings them under the limit
- A first experimental consumer tarball overlaid only Screen/icons on an older
  published build. This duplicated UiThemeContext and failed dark-theme propagation.
  It was rejected. Rebuilding every entry together fixed the candidate and passed
  the consumer's regression. Release artifacts must always use the full build

## Hosted verification (2026-09-30 17:30 BRT)

Run https://github.com/12-apps/shared-packages/actions/runs/36772172767 passed
Build, Lint, Type Check, Unit Tests, Static Gates (including knip), web Storybook,
Consumer Verification and Native Harness. Every dispatched job used ubuntu-latest
in the GitHub Actions runner group. The native Storybook lane caught four new
play tests querying before the unseeded safe-area provider's initial effect.
The tests now await the actual elements with findByTestId; no assertion is removed
and runtime code is unchanged. The other 630 native story cases passed (two
pre-existing web-only cases were skipped). Final retry and release status live at
https://github.com/12-apps/shared-packages/pull/736.

Local native Storybook build passed; browser execution was blocked by the
execution environment's Chromium Unix-socket restriction, including the supported
escalation attempt. Hosted browser evidence is authoritative for this lane.
