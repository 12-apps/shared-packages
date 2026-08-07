# Portability-gate fixtures

Proof material for `eslint.payments-portability.config.mjs`. Each `violates-*`
file breaks exactly one rule; each `clean-*` file is the same shape written
correctly. `scripts/payments-portability-selftest.mjs` lints every one of them
through the real gate config — under a **pretend file path** inside the package
or package-consumer the rule is scoped to — and fails if a `violates-*` comes
back clean or a `clean-*` comes back dirty.

They are lint fixtures, not modules: nothing imports them, they are ignored by
the gate's own run (see the `ignores` block in the config), and the imports
inside them are not expected to resolve.

The point is the failure mode a scoped gate has: if a `files:` glob stops
matching — a folder moves, a package is renamed, a nested workspace changes
shape — the gate keeps exiting 0 and keeps reporting a safety it is no longer
providing. That is worse than having no gate, because nobody looks again. These
fixtures make "the rule still fires" a thing CI asserts rather than a thing
someone believed once.
