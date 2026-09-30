# Screen

A cross-platform bounded screen with safe-area edges, scrolling and keyboard lift.
See Screen.md for every prop and tests.md for the evidence and failures.

## Lint / Type Errors
Package lint and all three check-types programs pass. The guidelines mention
`check:component`, but that command/script is absent; current package scripts apply.

## Testing Scenarios
Shared play tests cover real overflow, child-owned scrolling, form interaction
and empty content. Unit tests cover inset ownership and repeated native policy
changes. Device keyboard/notch/rotation QA is not claimed.

## Current
2026-09-30 17:30 BRT: Source review addressed safe-area/keyboard nesting,
child-owned viewport sizing, Android avoidance disabling and stale initial inset
metrics on remount. The optional native peer does not affect web-only consumers.
Screen and three generated tab glyphs are additive; existing component contracts
are unchanged. Refreshed onto main dd971d29 after the concurrent color-role merge.

Full build, final-source package suites/types, lint, parity and aggregate quality
passed locally. Source/packaging review approved 0fee5e6. Hosted web/native harness
checks passed; native play tests now await safe-area initialization. Final hosted
retry and release status are recorded on PR #736. Normal
reviewed CI/CD publishes after merge; no manual package version or publish.
