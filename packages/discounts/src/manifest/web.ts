/**
 * `@12-apps/discounts/manifest/web` — the browser capabilities.
 *
 * Two contributions. `surface` is the `createWeb*` convention the contract
 * names: one config object in, an object of component types out, memoised by
 * the host because the members are TYPES. `areas` is the declaration half — a
 * route and a nav row this package SUGGESTS for a host's admin area, which the
 * host is free to relabel, reorder or veto at its single call site.
 *
 * ## Why this capability exists now, and did not before
 *
 * The manifest used to refuse it, and said why:
 *
 * > The admin grid, the form and the target pickers stay host surfaces for now.
 * > They are three quarters product copy and host design system, and a surface
 * > declared before its copy is host config is the exact anti-pattern the
 * > copy-portability gate exists to refuse.
 *
 * Both halves were true when written and neither is now. The copy IS host
 * config — `DiscountsWebCopy`, required, no defaults, the third such port in
 * this package. And the "host design system" is `@12-apps/ui`, a shared
 * package these screens already read eighteen symbols from; what genuinely was
 * host-grown underneath them — the kebab, the card context, the confirm hooks,
 * the server-grid hook, the export — moved into `@12-apps/ui` and
 * `@12-apps/app-shell` first, which is why this could follow.
 *
 * Behind its own subpath so a server bundle importing the shared manifest never
 * resolves React.
 */

import type { AnyWebManifest } from "@12-apps/wiring";

import { createWebDiscounts } from "../react/create-web-discounts";

export const discountsWebManifest = {
  name: "@12-apps/discounts",
  surface: { create: createWebDiscounts },
  areas: [
    {
      area: "admin",
      routes: [
        {
          path: "discounts",
          screen: "Screen",
          // The write privilege gates the ROUTE, not just the create button:
          // the grid is an operator's view of what the store charges, and a
          // read-only visitor has `discounts:read` for the storefront's sake
          // rather than for this page's.
          permission: "discounts:read",
        },
      ],
      nav: [{ testId: "nav-discounts", path: "discounts", permission: "discounts:read" }],
    },
  ],
} as const satisfies AnyWebManifest;
