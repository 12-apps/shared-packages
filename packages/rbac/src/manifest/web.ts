/**
 * `@12-apps/rbac/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebRbac`, unchanged: the role editor, the team
 * screen, and the tabbed page that holds both, built once per adoption by the
 * consumer's binder (the members are component TYPES, so rebuilding per render
 * unmounts the tree mid-edit).
 *
 * ## Why this manifest exists now
 *
 * The shared manifest narrowed `web` away with a reason that reads plausibly
 * and is FALSE: "listing it would oblige every SERVER host adopting this
 * manifest to answer for a React surface it never mounts — `assemble()`
 * refuses a declared-but-unanswered capability, so the inventory must not
 * overstate."
 *
 * The consumer does not behave that way. A capability declared for the OTHER
 * runtime is reported `out-of-scope` ("a web host answers for this") and
 * `assemble()` returns; only a capability applicable to the adopting runtime
 * and left unanswered is `unbound`. `@12-apps/wiring`'s own fixture package
 * declares both halves, and its server-host suite asserts that the surface
 * comes back `out-of-scope` rather than red. So the narrowing protected
 * nothing and cost the capability its whole purpose: a host cannot adopt
 * screens no manifest mentions.
 *
 * ## The areas
 *
 * One admin area with the two screens the package routes, plus the tabbed page
 * for a host that wants them behind one path. Rows are SUGGESTIONS: the host
 * owns placement, icons, badges and every word (`RbacWebCopy.permissionLabels`
 * is already required config for exactly that reason). The permission gates
 * are named in the PACKAGE's vocabulary — `team:read` and `roles:manage` are
 * two of the three ids `RBAC_PERMISSIONS` contributes, so a host projecting
 * them is mapping ids it already received rather than guessing at host
 * vocabulary the contract forbids a package to assume. (A host that spells
 * them otherwise already remaps through `gatePermissions`, and the manifest
 * test pins these two against the contribution so a rename cannot desync them.)
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebRbac } from '../react/create-web-rbac';

export const rbacWebManifest = {
  name: '@12-apps/rbac',
  surface: { create: createWebRbac },
  areas: [
    {
      area: 'admin',
      routes: [
        { path: 'team', screen: 'TeamScreen', permission: 'team:read' },
        { path: 'roles', screen: 'RolesScreen', permission: 'roles:manage' },
      ],
      nav: [
        { testId: 'rbac-team', path: 'team', permission: 'team:read' },
        { testId: 'rbac-roles', path: 'roles', permission: 'roles:manage' },
      ],
    },
  ],
} as const satisfies AnyWebManifest;
