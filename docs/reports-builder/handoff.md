# Handing this to a coding agent

The plan document is not the instruction. The instruction is a small, bounded task that points at the plan. This file is the method plus the prompts.

## The four rules

### 1. The spec lives in the repo, not in the prompt.

```
docs/reports-builder/
  plan.md            # report-builder-implementation-plan.md
  notes.md           # report-builder-notes.md (mobile / a11y / data model)
  prototype.html     # report-builder-v2.html — behavioural reference
```

Commit these first, on their own. An agent that can `read` a file mid-task holds far more of it than one working from a pasted wall that scrolls out of its own context. It also means every session starts from the same source of truth instead of your paraphrase of it.

### 2. One commit per session. Never a phase.

"Implement Phase 2" produces a 900-line diff touching twelve files, and reviewing it costs more than writing it. Each entry in the plan is deliberately sized to be one session, one commit, one PR-able unit.

### 3. Plan before code, always.

Make the agent report what it found and what it intends to change before it writes anything. Most bad agent output comes from a wrong assumption in the first 30 seconds — about where a component lives, or which of three similar hooks is the live one. Catching that costs one message; catching it after implementation costs a rewrite.

### 4. Acceptance criteria become tests, not vibes.

Every entry in the plan has an `Acceptance` line written to be checkable. Require it as an executable test in the same commit. "Done" means the test passes, not that the agent says it's done.

---

## Prompt 1 — Orientation (run once per phase)

```
Read docs/reports-builder/plan.md.

Before writing any code, map the plan onto this repo:

1. For each commit in Phase 0, tell me which files/modules it touches
   and whether the thing it describes already exists in some form.
2. Flag anything in the plan that's wrong about this codebase — it was
   written from screenshots, not from the source.
3. Flag any commit whose "Depends on" isn't satisfiable in the order given.

Output a table. Do not change any files.
```

This is worth its own session. It surfaces "we already have a field registry, it's just incomplete" — which changes half the plan and which no amount of careful spec-writing would have caught.

## Prompt 2 — Implement one commit

```
Implement this commit from docs/reports-builder/plan.md:

  feat(reports): drive measure and aggregation pickers from the catalog

Reference: docs/reports-builder/prototype.html — search for `renderPanel`
and `AGG_BY_TYPE` for the intended behaviour. Match the behaviour, not
the markup; use our existing components.

Before coding, tell me:
- which files you'll change and why
- what you'll write for the acceptance criterion:
  "Soma de Status is not expressible through the UI"
- anything in the plan that doesn't fit this codebase

Wait for my go-ahead. Then implement, add the test, and run
typecheck + tests + lint. Out of scope: everything else in the plan,
any refactor not required by this change, chart rendering.
```

The "out of scope" line matters more than it looks. Without it, an agent that notices the axis-label bug while working on the panel will fix it too, and now your commit is two commits and your review is twice as slow.

## Prompt 3 — Review before PR

```
Review your diff against the commit's Acceptance line in
docs/reports-builder/plan.md.

For each of these, answer yes/no with the evidence:
- Does the acceptance criterion have a test that fails without this change?
- Does the diff contain anything outside the commit's stated scope?
- Any behaviour in prototype.html for this feature that we didn't implement?
- Anything you had to guess about?

List what you'd flag in code review if someone else wrote this.
```

Your `code-checker` and `completion-checker` agents already do part of this — this is the spec-level version, checking against intent rather than against the code.

## Prompt 4 — Linear tickets

```
Read docs/reports-builder/plan.md. Create one Linear issue per commit:

- Title: the conventional-commit message
- Description: the Why paragraph + the code block, verbatim
- Acceptance criteria as a checklist
- Blocked-by relations from each "Depends on"
- Label by phase

Don't invent estimates. Show me the list before creating anything.
```

---

## Why agents flounder, and what to do about it

The three failure modes, roughly in order of frequency:

**The task has no edge.** "Improve the report builder" has no failure condition, so the agent invents one and stops somewhere arbitrary. Every task needs a sentence that could be false. If you can't write that sentence, the task isn't ready — that's information, not a blocker.

**The task is three tasks.** The agent does the first well, the second adequately, and the third in the last 5% of its context. Symptom: quality falls off toward the end of a long session. Fix: split at the seams the plan already marks.

**The agent is guessing about your codebase.** It doesn't know your naming, your existing abstractions, or which of two similar files is live. Prompt 1 fixes this, and its output is worth pasting into `CLAUDE.md` so the next session starts informed.

---

## When you're stuck on a feature and the agent isn't helping

The problem is almost always upstream of the agent. The recipe that worked here:

1. Show the current state — screenshots of every screen in the flow, or the files.
2. Get a critique first, separately from a fix. Naming what's wrong is a different task from deciding what to build, and merging them produces a plan optimised for looking thorough.
3. Get a prototype of the target state. A throwaway single-file HTML that behaves correctly is a far better spec than prose, because interaction details (snapping, weighting, what happens on cancel) are where prose silently omits the hard parts.
4. Turn it into bounded commits with acceptance criteria.
5. Then hand it to the agent, one commit at a time.

Steps 1–4 are the ones people skip, and they're the reason step 5 goes badly.
