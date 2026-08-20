# @12-apps/auth

Authentication as a plug-in: Auth.js wiring, the e-mail + password flow, the
screens and whole pages that flow needs, a mountable backend surface, and the
three tables it all runs on — with **no host's vocabulary anywhere in it**.

Same shape as `@12-apps/report-builder`, deliberately. If you have adopted that
one, you already know this one's layout.

| Entry point | Needs | What is in it |
|---|---|---|
| `.` | **nothing** | `createEmailCredentials`, password policy, tokens, the admin allowlist, the rate limiter, device detection |
| `./server` | nothing (Node) | the **Auth.js bridge** (`createApiAuth`, `auth`, `handlers`, `authConfig`, `credentialsProvider`), routes, status vocabulary, mail templates, and the duck-typed credential + settings **store seams** |
| `./react` | react, react-dom, `@12-apps/ui` | the screens, the whole login/sign-up **pages**, the platform settings screen |
| `./hono` | hono | one `mount` call for the whole backend surface |
| `./notifications` | `@12-apps/notifications` | `createAuthMailer` — the four auth e-mails over an `EmailDriver` |
| `./e2e` | `@playwright/test`, `playwright-bdd` | the packaged Gherkin journeys and their steps |

An entry point marks a distinct **peer**, never merely a module. Every peer is
optional, so a backend that never renders a page installs no react.

**`.` is the light half, and that is enforced.** It value-imports nothing — no
`@auth/core`, no react, no hono — so a background job that expires stale tokens
can `import { hashToken } from '@12-apps/auth'` and load only that. The Auth.js
runtime lives in `./server` for the same reason report-builder keeps
`createReportBuilder` there. `src/__tests__/light-root.test.ts` walks the root's
import graph and fails if that ever stops being true.

## The tables are the package's

`prisma/auth.prisma` owns `auth_credentials`, `auth_tokens` and
`auth_platform_settings`, with migrations beside them.

```bash
pnpm --filter @12-apps/auth prisma:sync        # copy the partial into your schema
pnpm --filter @12-apps/auth prisma:sync:check  # CI: fail if the copy drifted
```

The partial is **copied, never symlinked**: `npm pack` drops symlinked entries,
`turbo prune` dangles a link whose owner is not a declared dependency, and
Prisma `lstat`s a migration directory — so a symlinked one is silently skipped,
which is a green deploy that applied no schema.

Every user reference is an opaque `user_id` with **no foreign key into any host
table**. These migrations therefore apply in a repo whose users live under
another name, in another database, or do not exist yet.

## What stays yours

One thing, because it is the one thing a package cannot know: **who your users
are**. `EmailIdentityDelegate` is three methods — `findByEmail`, `findById`,
`upsert` — over your own user table. Everything else is here.

Alongside that, the choices that are genuinely a product's:

- **the words** — every copy pack is required, never defaulted (`PT_BR_*` ships
  as one for each surface);
- **the branding** — a slot on the pages, completely opaque to this package;
- **the providers** — a node you render, because an OAuth button carries a
  callback URL, a consent gate and a redirect this package cannot own;
- **the mail vendor** — you pass an `EmailDriver`; which service, which key and
  which from-address are yours. The sink and the refusal drivers ship here,
  because both are about *correctness* rather than preference.

## Security model

- `consumeToken` **must** be a conditional write (`UPDATE … WHERE consumed_at IS
  NULL`) reporting whether it affected a row. That return value is the
  single-use guarantee.
- Sign-up and password-reset answers are **identical** whether or not the
  address exists, and whether or not the mail left. That is why the mailer
  resolves rather than throws.
- A deployment with **no** mail provider refuses loudly instead of falling back
  to logging: a reset link in a log aggregator is a credential in a log
  aggregator.
- `requireEmailVerification` changes the sign-up **contract**, not just its
  security — see ADOPTING.md.

## Conventions

- Every surface is a `create*` factory taking **one config object**.
- Nothing here reads an environment variable.
- The database client is **duck-typed** (`AuthDb`, `AuthSettingsDb`); this
  package never resolves a generated Prisma client.
- Developer-facing text is English; the shipped copy packs are pt-BR.

Full wiring, endpoint list and the decisions that are not obvious:
[ADOPTING.md](./ADOPTING.md). Journeys and harness notes: [E2E.md](./E2E.md).
