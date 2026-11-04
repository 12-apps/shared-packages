---
name: no-whole-suite-runs
description: BLOCKS a whole-suite test command (pnpm test:all, turbo run test, a package's own test script, vitest run or playwright test with no file, a whole integration run where one exists) — run pnpm test:changed or the exact files instead
events: PreToolUse
trigger_pretool: Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n|\|)\s*)?(?:\(\s*)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:timeout|nice|time)(?:\s+-\S+)*(?:\s+\d+\S*)?\s+)*(?:pnpm|npm|yarn)(?:\s+(?:--filter|-F)(?:=|\s+)\S+|\s+(?:-r|--recursive|-w|--workspace-root|--silent|-s))*\s+(?:run\s+)?test:(?:all|integration|e2e|bdd|coverage)(?:\s+(?:--(?:config|project|reporter|pool|root|dir|shard|maxWorkers|minWorkers|environment|filter|workspace|outputFile|retry)(?:=|\s+)(?:'[^']*'|\\"[^"\\]*\\"|[^\s"\\&;|]+)|-[cF]\s+[^\s"\\&;|]+|-(?:-?[\w:.=/-]+)))*\s*(?:"|&&|\|\||;|\\n|\||\)|[12]?>),Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n|\|)\s*)?(?:\(\s*)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:timeout|nice|time)(?:\s+-\S+)*(?:\s+\d+\S*)?\s+)*(?:pnpm|npm|yarn)(?:\s+(?:--filter|-F|-C|--dir|--prefix)(?:=|\s+)\S+|\s+(?:-r|--recursive))+\s+(?:run\s+)?test(?:\s+(?:--(?:config|project|reporter|pool|root|dir|shard|maxWorkers|minWorkers|environment|filter|workspace|outputFile|retry)(?:=|\s+)(?:'[^']*'|\\"[^"\\]*\\"|[^\s"\\&;|]+)|-[cF]\s+[^\s"\\&;|]+|-(?:-?[\w:.=/-]+)))*\s*(?:"|&&|\|\||;|\\n|\||\)|[12]?>),Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n)\s*)?(?:\(\s*)?cd\s+\S*(?:apps|packages)(?:/[^\s/&;|"\\]+)+/?\s*(?:&&|;)\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:pnpm|npm|yarn)\s+(?:run\s+)?test(?:\s+(?:--(?:config|project|reporter|pool|root|dir|shard|maxWorkers|minWorkers|environment|filter|workspace|outputFile|retry)(?:=|\s+)(?:'[^']*'|\\"[^"\\]*\\"|[^\s"\\&;|]+)|-[cF]\s+[^\s"\\&;|]+|-(?:-?[\w:.=/-]+)))*\s*(?:"|&&|\|\||;|\\n|\||\)|[12]?>),Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n|\|)\s*)?(?:\(\s*)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:timeout|nice|time)(?:\s+-\S+)*(?:\s+\d+\S*)?\s+)*(?:(?:pnpm|npm|yarn)\s+(?:exec\s+|dlx\s+)?|npx\s+(?:--yes\s+)?|pnpx\s+)?turbo\s+(?:run\s+)?test\b,Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n|\|)\s*)?(?:\(\s*)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:timeout|nice|time)(?:\s+-\S+)*(?:\s+\d+\S*)?\s+)*(?:(?:(?:pnpm|npm|yarn)(?:\s+(?:--filter|-F)(?:=|\s+)\S+)*\s+(?:exec\s+|dlx\s+)?|npx\s+(?:--yes\s+)?|pnpx\s+)?vitest(?:\s+run)?|node\s+\S*vitest-with-teardown\.mjs\s+run)(?!(?:\s+-[^\s"\\&;|]*)*\s+--changed\b)(?:\s+(?:--(?:config|project|reporter|pool|root|dir|shard|maxWorkers|minWorkers|environment|filter|workspace|outputFile|retry)(?:=|\s+)(?:'[^']*'|\\"[^"\\]*\\"|[^\s"\\&;|]+)|-[cF]\s+[^\s"\\&;|]+|-(?:-?[\w:.=/-]+)))*\s*(?:"|&&|\|\||;|\\n|\||\)|[12]?>),Bash:"command":"(?:(?:[^"\\]|\\.)*?(?:&&|\|\||;|\\n|\|)\s*)?(?:\(\s*)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:(?:timeout|nice|time)(?:\s+-\S+)*(?:\s+\d+\S*)?\s+)*(?:(?:pnpm|npm|yarn)\s+(?:exec\s+)?|npx\s+(?:--yes\s+)?)?playwright\s+test(?!(?:\s+[^\s"\\&;|]+)*?\s+--list\b)(?:\s+(?:--(?:config|project|reporter|pool|root|dir|shard|maxWorkers|minWorkers|environment|filter|workspace|outputFile|retry)(?:=|\s+)(?:'[^']*'|\\"[^"\\]*\\"|[^\s"\\&;|]+)|-[cF]\s+[^\s"\\&;|]+|-(?:-?[\w:.=/-]+)))*\s*(?:"|&&|\|\||;|\\n|\||\)|[12]?>)
trigger_session: false
inject: full
enforce: block
---

# A whole suite never runs on this machine. Run what the change reaches.

Owner, 2026-11-03 (translated): "why the hell isn't running the selective packages
already the default?" Whole-package runs burned about an hour per agent: 2,366
payments-backend tests and 2,340 payments-frontend tests, twice per PR, for
one-function changes (FUT-4072, FUT-4080, FUT-4317).

**Run one of these instead:**

| you want | run |
|---|---|
| the tests your branch AND your uncommitted edits reach | `pnpm test:changed` |
| only your uncommitted edits | `pnpm test:changed --uncommitted` |
| one or more test files | `npx vitest run <file…>` from the package |
| the tests that import a source file | `npx vitest related --run <src…>` |

CI selects and runs the rest by what the diff reaches. A whole package or the whole
repo is never an agent's job.

**Report what you ran:** the selective command and the number of files it picked. "The
full suite passes, N tests" in a report is a defect of the run, not diligence.

This memory blocks the COMMAND, not text: a `grep`, `rg`, `echo` or `git log --grep`
that only mentions one of these runs freely. A heredoc whose body has the command on its
own line is a known false block; write the file with the Write tool instead.

A deliberate whole run (the owner asked for one, or you are reproducing a CI red):
append `# synapsys:override=no-whole-suite-runs reason="<why, 10+ chars>"` to the
SAME command. The override is logged.
