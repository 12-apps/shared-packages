# Open-source assessment — `12-apps/shared-packages` and `12-apps/ci`

Evaluates whether making these two repositories public would hurt, and whether it
would cut the CI bill. Both repos were audited in full (working tree + complete
git history) on 2026-08-04.

**Short answer:** publishing does not hurt — the code is clean and the community
value is real — and it *does* cut the CI bill, but the lever is **where the code
lives**, not which repo hosts the workflows. Every line that sits in a public
package is a line whose lint/test/build is free, once, forever, instead of
billed inside each private consumer.

---

## 1. The CI-cost model

GitHub Actions is free on public repos with standard runners; private repos get
2,000 min/month (Free), 3,000 (Team), or 50,000 (Enterprise Cloud). Going public
*is* free CI — for the repo that goes public.

Which repo pays matters, though. From GitHub's billing docs: **"If you reuse a
workflow, billing is always associated with the caller workflow."** Minutes are
charged to the repository that triggers the run, not the one hosting the
reusable workflow. That has one narrow consequence and one broad one, and they
point in opposite directions.

### The narrow consequence: publishing `ci` saves nothing directly

`12-apps/ci` is a workflow host. It is 218 KB across 38 commits, and its own CI
is a single `release-major-tag` workflow on push. Consumers' runs bill to the
consumer, never here. Publishing it is worth doing — see §3 — but not for the
minutes.

### The broad consequence: code placement is the real lever

This is where the saving actually is. CI cost scales with the code a repo has to
lint, type-check, build, and test. So:

- Code in a **private** repo costs minutes on every PR touching it.
- Code in a **public** package costs nothing, forever.
- Code shared by *N* private consumers, if it lives in each of them, costs
  minutes *N* times over. Centralised in one public package, it costs nothing
  and is tested once.

That third point is the compounding one, and it grows with the org. Today
`future-pay` is the only serious consumer. With `future-drink` arriving as a
second, and `base-app` as a third, the ratio of "shared code that could be
public" to "app-specific code that must stay private" moves further in favour of
publishing.

So the strategy is sound: move as much as possible into `shared-packages`, make
it public, and let each private app repo carry only its thin app-specific layer.
The historical run count in this repo (14 runs, all on 2026-07-17) is not
evidence against that — it is a two-week-old repo that has barely started
absorbing code.

**What still bills in the private consumers**, so the saving is large but not
total: dependency install, type-checking *against* the packages, e2e that
exercises them, and all app-specific code. What goes away is the unit tests,
lint, and build of the shared code — which is most of the per-PR cost.

**Second cost line, same decision:** every package currently sets
`publishConfig.access: "restricted"`, and `ci.yml` publishes with
`npm publish --access restricted`. Restricted scoped packages require a paid npm
organisation. Going public means `access: public`, which removes that bill
entirely.

### The third lever, independent of visibility

Billed minutes are the *sum* of all job-minutes, rounded up per job, not
wall-clock. This repo's `ci.yml` runs `lint`, `type-check`, `build`, and
`unit-tests` as four separate jobs — four runners, four checkouts, four full
`pnpm install --frozen-lockfile` of a workspace carrying MUI, Prisma, Storybook
and Playwright. The installs dominate, and they are paid four times over.

Measured on the run for PR #4, a docs commit plus two one-line edits:

| Job | Duration | Billed |
|-----|----------|--------|
| Lint | 67s | 2 min |
| Type Check | 61s | 2 min |
| Build | 60s | 1 min |
| Unit Tests | 122s | 3 min |
| Quality / Static Gates | 96s | 2 min |
| CI Success | 4s | 1 min |
| **Total** | **2m13s wall** | **11 min billed** |

Five times the wall-clock, for a change that touched no shared code.
Consolidating the four install-heavy jobs into one removes three redundant
installs and most of the per-job rounding. It trades parallel wall-clock for
minutes — if fail-fast feedback matters more, keep them split and accept the
multiplier, but that is a tradeoff to make deliberately.

Also: `turbo --affected` with a cross-run `.turbo` cache is already wired into
`12-apps/ci`'s `monorepo-static.yml`, but this repo's `ci.yml` calls `pnpm lint`
/ `pnpm check-types` directly, so it rebuilds everything on every PR. Routing
this repo through the org's own reusable static pipeline would pick that up.

This lever applies whether or not the repo goes public — but it stops mattering
here the moment it does, and starts mattering more in the private consumers.

---

## 2. Does publishing hurt? — audit findings

### Verified clean

- **No secrets, in either repo, anywhere in history.** Scanned working trees and
  full git history (`shared-packages`: 12 commits; `ci`: 38 commits, unshallowed
  for the scan). No deleted `.env`/`.pem`/key files, no hardcoded credential
  literals. Every CI secret is referenced through `secrets.*` / `vars.*`:
  `DO_API_TOKEN`, `DO_SSH_PRIVATE_KEY_B64`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `DOPPLER_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`.
- **No internal infrastructure values.** `.github/deploy/targets.json` holds
  vendor descriptors only. `DEPLOY_HOST` (the droplet IPv4) is a repo variable,
  never committed. The one IP in the tree, `169.254.169.254`, is the standard
  cloud metadata endpoint.
- **No licence conflict.** UI depends on `@mui/material` v6 and
  `@mui/icons-material` v6 — both MIT. No MUI X Pro/Premium, so nothing
  commercially licensed gets redistributed.
- **Test fixtures are already generic** — `example.com` throughout, apart from
  the one case fixed below.

### Fixed in PR #4

1. `packages/shared-helpers/prisma/seed-admin-demo.ts` hardcoded a real personal
   Gmail address as the default dev-admin when `DEV_ADMIN_EMAIL` is unset.
   Replaced with `dev-admin@example.com`. Worth fixing whether or not the repo
   ever goes public.
2. `packages/mcp/src/auth/authorization-server-metadata.test.ts` used
   `https://tenant.futuredrink.com.br` as an OAuth issuer fixture. Replaced with
   `tenant.example.com`. This is *not* a customer domain — it is the org's own
   `future-drink` project. The redaction still stands, for a different reason: a
   public repo should not telegraph an unannounced product name, and a test
   fixture should not hardcode any product's domain.

### Blocker — RESOLVED

> **Status:** resolved when the packages were re-imported from `future-pay`.
> `packages/shared-helpers/prisma/schema/schema.prisma` is now datasource +
> generator only; the app's domain models never came across. What the host
> schema holds is 17 models, every one of them owned by a plugin package in
> this repo (`entity-lifecycle`, `product-research`, `report-builder`, `shift`,
> `payments-backend`), synced in by each package's own script. `prisma generate`
> and the full test suite pass against it. Two modules stayed behind for the
> same reason the schema did — see *Excluded* below. The original finding is
> kept here because it is why the split was done.

**`packages/shared-helpers/prisma/` was one app's data model, not a shared
helper.** It carries a 1,122-line schema with 38 models, 27 migrations, and
seed data — the full commerce domain: `Order`, `OrderCharge`, `Payment`,
`SavedCard`, `CustomerProfile`, `StockLot`, `StockMovement`, `Recipe`,
`RecipeComponent`, `Supplier`, `LossEvent`, `OAuthClient`, `OAuthRefreshToken`,
`McpConnection`, `Membership`, `PaymentIntegration`. Publishing it publishes
`future-pay`'s design — every entity, every relationship, every payment state
transition. It also carries 41 `FUT-*` internal tracker references.

Two independent reasons this has to be resolved first, and the second is the
important one:

1. **Disclosure.** A public repo would expose the product's complete data model.
2. **It blocks the multi-project plan outright.** The entire point of pushing
   code into `shared-packages` is that `future-drink` and `future-pay` can share
   it. A schema hardcoded to one app's domain cannot be shared by two apps — so
   this split has to happen for the refactor to work *even if the repo stays
   private forever*. Open-sourcing just makes the deadline visible.

What was done: the schema, its migrations and its seeds stayed in the app. The
generic Prisma *helpers* in `src/prisma/` — `actor-context.ts`,
`audit-extension.ts`, `append-only-extension.ts`, `search-normalize.ts` — came
across, because they carry no models and are reusable by both apps.

### Excluded — host-coupled, not shareable

Three things were deliberately left in `future-pay`, each for the same reason:
they cannot function without the app's schema or its screens.

- **`shared-helpers/src/notifications/`** — the only module in the package that
  touches Prisma model delegates, and it needs five app-owned models
  (`Notification`, `NotificationPreference`, `NotificationDelivery`,
  `PushSubscription`, and `User`). Its own header already flagged it as a
  placement call that could lift out later; it needs its own schema partial
  before it can ship, plus a port for the user lookup.
- **`spa-shared`** — app glue, not a library: `brand.ts` is literally product
  branding, and the impersonation UI is wired to `apps/admin`.
- **`state-api-library`** — unclear provenance. It is ISC-licensed, `private`,
  outside the `@repo` scope, and its own description refers to "each G2i AI
  app", so it appears to be vendored from elsewhere. Publishing code whose
  origin is not established is the one licence risk in the set; establish where
  it came from before moving it anywhere.

### Legal and hygiene gaps

3. **No LICENSE file exists anywhere in either repo**, yet `mcp`,
   `shared-helpers`, and `typescript-config` already declare `"license": "MIT"`
   in `package.json`. Publishing MIT-declared code with no licence text is
   legally ambiguous — nobody can rely on it. Add a root `LICENSE`, set the
   `license` field on every package, and include `LICENSE` in each package's
   `files` array. MIT is the already-declared intent.
4. **`publishConfig.access` is `"restricted"` on every package**, and `ci.yml`
   publishes with `npm publish --access restricted` — see §1, this is the second
   cost line the same decision removes.
5. **No `README` worth the name** (one line), no `SECURITY.md`, or issue
   templates. A public repo without them collects low-quality issues and has no
   channel for vulnerability reports. *(`CONTRIBUTING.md` — FUT-750 — closed the
   commit-convention half of this; the rest stands.)*

### Leaks that are real but low-harm

- `12-apps/ci`'s `README.md` and `CONSUMING.md` name `future-pay`, `apps/web`,
  and `apps/admin`, and document the deployment topology (DigitalOcean droplet
  running docker-compose, GHCR images, Cloudflare Pages/Workers) plus the exact
  secret *names* consumers must set. This is architecture disclosure, not
  credential disclosure — mild reconnaissance value, nothing exploitable.
  Arguably it is the documentation that makes the framework adoptable.
- `packages/shared-helpers/src/impersonation/` implements Azure AD user
  impersonation over Microsoft Graph, including the admin-role-prefix check that
  gates it. The code is generic and correct-looking, but an authorization
  primitive is the one category where publishing invites targeted scrutiny.
  Worth a dedicated security review before it ships publicly, or keep it back.
- `packages/auth` implements admin access as an `ADMIN_EMAILS` env-var
  allowlist with no roles. That is a deliberate, documented choice, but
  publishing it invites "you have no RBAC" criticism. Low risk, low value.

---

## 3. What is actually worth publishing

Ranked by community value against maintenance cost:

| Package / repo | Value | Risk | Verdict |
|---|---|---|---|
| **`12-apps/ci`** | High | None | **Ship first.** |
| **`@12-apps/mcp`** | High | None after the domain fix | **Strong flagship candidate.** |
| **`@12-apps/ui`** | High | Low | Ship only with maintainer appetite. |
| **`@12-apps/shared-helpers`** (minus `prisma/`) | Medium | Medium | Split first. |
| `@12-apps/eslint-config`, `@12-apps/typescript-config` | Low | None | Free to ship, nobody needs them. |
| `@12-apps/auth` | Low | Low | Optional. |
| `@12-apps/onboarding` | Low | None | Coupled to a specific `OnboardingState` model. |

**`12-apps/ci` is the best candidate and it is not close.** The CD framework is
vendor-pluggable and genuinely generic, but the quality-gate suite is the
unusual part: complexity and flakiness lint, `jscpd` duplication, a **knip
shrink-only ratchet** that only fails on *new* dead code, a flaky-test
quarantine, MCP contract drift detection, RBAC and entitlement coverage gates,
e2e page↔spec coverage, and Next.js `loading.*` coverage — all with
grandfathering exception files designed to be burned down rather than
permanently suppressed. The `.quality-exceptions` burn-down pattern is a real
idea most teams reinvent badly. There is nothing proprietary in it.

Publishing `ci` also has a concrete ergonomic payoff: `CONSUMING.md` §1 exists
only because a *private* reusable-workflow repo needs
`Settings → Actions → Access → "Accessible from repositories in the 12-apps
organization"`, and the README notes composite actions are "the only way a
consumer's job token can run private-repo scripts without a dedicated PAT."
Public actions and reusable workflows are callable by anyone with no org setting
and no PAT. That whole class of setup friction disappears.

**`@12-apps/mcp`** is the timeliest. An app-agnostic OpenAPI→MCP generator that
proxies each tool call to the real endpoint carrying the caller's bearer token —
holding *zero* authorization logic, so the agent can do exactly what the user
can — is a pattern people are actively looking for. It is already written
app-agnostic, already declares MIT, and after the `futuredrink` fix has no
internal references left beyond two doc mentions of `future-pay`.

**`@12-apps/ui`** is ~90 MUI-based components across ~155k LOC (mostly stories
and test-stories). Real value, but public means issues, accessibility reports,
and MUI major-version churn arriving on someone's desk. Ship it only as a
deliberate commitment.

---

## 4. Recommended sequence

The `future-drink` refactor and the open-source decision are the same project.
Both require the shared/app-specific boundary to be drawn properly, so do that
once and get both payoffs.

1. **Do the `prisma/` split first.** It gates everything else: the multi-project
   refactor cannot work with one app's schema in the shared package, and the
   repo cannot go public with it either. Move the schema out; keep the generic
   helpers in `src/prisma/`.
2. **While splitting, sort every module into shared vs app-specific.** Whatever
   lands on the shared side is code that will be CI-free forever and reused by
   both apps; whatever lands app-specific keeps costing minutes in a private
   repo. That sort *is* the cost decision — make it deliberately rather than by
   default.
3. **Publish `12-apps/ci`** as-is. Add LICENSE, CONTRIBUTING, SECURITY. Zero
   cleanup needed, highest community value, and it removes the org-access/PAT
   setup step every consumer currently needs. It saves no minutes directly — do
   it for those reasons.
4. **Publish `@12-apps/mcp`** with `access: public`. It is the flagship and it
   is ready now.
5. **Flip `shared-packages` public** once step 1 lands, with `access: public` on
   every package and a root LICENSE. This is where the recurring saving is, on
   both the Actions and the npm line.
6. **Independently, fix the job topology** — consolidate the four install-heavy
   jobs, route through `monorepo-static.yml` for `turbo --affected` and the
   `.turbo` cache. It stops mattering here once the repo is public, but the same
   fix applies in `future-pay` and `future-drink`, where it will keep mattering.

## Sources

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Billing and usage — reusable workflows](https://docs.github.com/en/actions/concepts/billing-and-usage)
